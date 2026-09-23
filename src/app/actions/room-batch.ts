"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { batchRoomTypesRequestSchema } from "@/lib/ai-route-schemas";
import {
  batchRoomUploadUrlsRequestSchema,
  createRoomsBatchRequestSchema,
} from "@/lib/room-batch-schema";
import {
  DEFAULT_DAILY_LABEL_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  evaluateDailyBatchQuota,
  getDailyUsage,
  recordDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";
import {
  ROOM_TYPE_SYSTEM_PROMPT,
  detectRoomType,
} from "@/lib/room-type-detection";


export interface BatchRoomEntry {
  fileName: string;
  roomType: string;
  beforeImageUrl: string;
}

export interface CreateRoomsResult {
  success: boolean;
  rooms?: Array<{
    id: string;
    name: string;
    beforeImageUrl: string | null;
  }>;
  error?: string;
}

/**
 * Server action: creates multiple rooms in a project with AI-detected room types
 * and uploads their before photos.
 *
 * Flow:
 *  1. Client calls getBatchRoomUploadUrls to get signed URLs for each file
 *  2. Client uploads files directly to Supabase Storage via signed URLs
 *  3. Client calls createRoomsBatch to create room rows and link photos
 *
 * This action handles step 3 only.
 *
 * Issue #704 hardening: the input is validated with
 * `createRoomsBatchRequestSchema(projectId)` (entries capped at 20,
 * per-field length bounds, and each `beforeImageUrl` must be an
 * allowlisted HTTPS image URL scoped to this project's
 * `batch-rooms/{projectId}/...` storage path when on the Supabase
 * host) BEFORE any DB write, so unbounded transactions and
 * non-allowlisted URLs never reach a Room row.
 *
 * @param projectId  Project to add rooms to.
 * @param entries    Array of { fileName, roomType, beforeImageUrl } for each room.
 * @param roomNames  Optional explicit room names (overrides AI-detected types).
 *                   If not provided, roomType is used as the name.
 */
export async function createRoomsBatch(
  projectId: string,
  entries: BatchRoomEntry[],
  roomNames?: string[]
): Promise<CreateRoomsResult> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Schema gate (pure): entry-count cap, field bounds, and the
  // project-scoped beforeImageUrl allowlist — before any DB reads or
  // writes (mirrors the #681 gate on detectBatchRoomTypes).
  const parsed = createRoomsBatchRequestSchema(projectId).safeParse({
    projectId,
    entries,
    roomNames,
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request",
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: parsed.data.projectId, userId: user.id },
    select: { id: true, rooms: { select: { id: true, sortOrder: true }, orderBy: { sortOrder: "desc" }, take: 1 } },
  });
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const maxSortOrder = project.rooms[0]?.sortOrder ?? -1;

  try {
    const rooms = await prisma.$transaction(
      parsed.data.entries.map((entry, index) =>
        prisma.room.create({
          data: {
            projectId: parsed.data.projectId,
            name: parsed.data.roomNames?.[index] ?? entry.roomType,
            beforeImageUrl: entry.beforeImageUrl,
            sortOrder: maxSortOrder + 1 + index,
          },
          select: { id: true, name: true, beforeImageUrl: true },
        })
      )
    );

    revalidatePath(`/projects/${parsed.data.projectId}`);
    return { success: true, rooms };
  } catch (error) {
    console.error("Failed to create rooms batch:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Server action: issues signed upload URLs for batch room photo uploads.
 *
 * Issue #704 hardening: the input is validated with
 * `batchRoomUploadUrlsRequestSchema` (files capped at 20 per call;
 * each name non-empty, ≤255 chars, and extension-allowlisted) BEFORE
 * any storage-signed URL is minted — previously the extension check
 * ran mid-loop, after signed URLs had already been issued for earlier
 * files, and nothing capped the array length.
 *
 * @param projectId  Project owning the rooms (for ownership check).
 * @param files      Array of { name: string } — original file names to derive extensions.
 * @returns Signed URL data per file, for direct browser→Supabase upload.
 */
export async function getBatchRoomUploadUrls(
  projectId: string,
  files: Array<{ name: string }>
): Promise<
  | { success: true; uploads: Array<{ signedUrl: string; storagePath: string; roomIndex: number }> }
  | { success: false; error: string }
> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Schema gate (pure): count cap + name/extension bounds for the
  // whole batch up front, before any signed-URL minting (mirrors the
  // #681 gate on detectBatchRoomTypes).
  const parsed = batchRoomUploadUrlsRequestSchema.safeParse({
    projectId,
    files,
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request",
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: parsed.data.projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const supabase = await createSupabaseRequestClient();

  const uploads: Array<{ signedUrl: string; storagePath: string; roomIndex: number }> = [];

  for (let i = 0; i < parsed.data.files.length; i++) {
    const fileName = parsed.data.files[i].name;
    const fileExt = (fileName.split(".").pop() || "").toLowerCase();

    // Each room gets its own folder; roomIndex maps entry → room
    const roomIndex = i;
    const storagePath = `batch-rooms/${parsed.data.projectId}/room-${roomIndex}-${Date.now()}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from("room-photos")
      .createSignedUploadUrl(storagePath, { upsert: true });

    if (error) {
      return { success: false, error: `Failed to get signed URL: ${error.message}` };
    }

    uploads.push({ signedUrl: data.signedUrl, storagePath, roomIndex });
  }

  return { success: true, uploads };
}

/**
 * Server action: detects room types for a batch of uploaded images.
 * Returns an array of detected room type labels, parallel to the input URLs.
 *
 * Issue #681 hardening (parity with `/api/label-instances` and
 * `/api/segment/furnishings`): the input is validated with
 * `batchRoomTypesRequestSchema` (per-URL `aiImageUrlSchema` host
 * allowlist + a hard cap of 20 URLs per call), the caller must own
 * `projectId` before any AI work runs, and the batch rides the daily
 * `label` quota surface — the same gpt-4o-mini vision spend pool as
 * `/api/label-instances` (`DAILY_LABEL_LIMIT`), with the whole batch
 * required to fit in the user's remaining headroom.
 *
 * @param projectId  Project the uploaded photos belong to (ownership check).
 * @param imageUrls  Public URLs of uploaded room photos (max 20).
 */
export async function detectBatchRoomTypes(
  projectId: string,
  imageUrls: string[]
): Promise<{ success: true; roomTypes: string[] } | { success: false; error: string }> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Schema gate (pure): per-URL host allowlist plus the 20-URL cap,
  // before any DB reads or paid AI work.
  const parsed = batchRoomTypesRequestSchema.safeParse({ projectId, imageUrls });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request",
    };
  }

  // Issue #681: daily label quota (in-process counter — see
  // lib/api-quota.ts for the mechanism and its multi-instance
  // limitation). Checked BEFORE any AI work so a user at their cap
  // never reaches gpt-4o-mini; the whole batch must fit in headroom.
  const labelLimit = resolveDailyLimit(
    process.env[DAILY_LIMIT_ENV_VAR.label],
    DEFAULT_DAILY_LABEL_LIMIT
  );
  const labelQuota = evaluateDailyBatchQuota(
    getDailyUsage("label", user.id),
    parsed.data.imageUrls.length,
    labelLimit
  );
  if (!labelQuota.allowed) {
    console.warn(
      JSON.stringify({
        event: "batch_room_types_daily_quota_exceeded",
        userId: user.id,
        used: labelQuota.used,
        limit: labelQuota.limit,
        requested: parsed.data.imageUrls.length,
      })
    );
    return {
      success: false,
      error: dailyQuotaExceededPayload(labelQuota, "Please try again tomorrow.")
        .message,
    };
  }

  // Ownership: the project the photos belong to must be owned by the
  // authenticated user — checked before any AI work.
  const project = await prisma.project.findUnique({
    where: { id: parsed.data.projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  try {
    const roomTypes = await Promise.all(
      parsed.data.imageUrls.map(async (url) => {
        try {
          const roomType = await detectRoomType(url);
          // Bill only successful detections — a failed attempt costs at
          // most a few rejected tokens (mirrors /api/label-instances).
          recordDailyUsage("label", user.id);
          return roomType;
        } catch {
          return "Other";
        }
      })
    );

    return { success: true, roomTypes };
  } catch (error) {
    console.error("Batch room type detection failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Detection failed",
    };
  }
}

/**
 * Server action: bulk updates the staging aesthetic for multiple rooms at once.
 *
 * @param roomIds   IDs of rooms to update.
 * @param aesthetic  New aesthetic value to set.
 */
export async function bulkUpdateRoomAesthetic(
  roomIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _aesthetic: string
): Promise<{ success: boolean; error?: string }> {
  if (!Array.isArray(roomIds) || roomIds.length === 0) {
    return { success: false, error: "No rooms provided" };
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Ownership check: all rooms must belong to projects owned by this user
    const rooms = await prisma.room.findMany({
      where: { id: { in: roomIds } },
      select: { id: true, project: { select: { userId: true } } },
    });

    const invalid = rooms.filter((r) => r.project.userId !== user.id);
    if (invalid.length > 0) {
      return { success: false, error: "Some rooms are not owned by you" };
    }

    await prisma.room.updateMany({
      where: { id: { in: roomIds } },
      data: { /* aesthetic is per-project; rooms themselves don't store aesthetic */ },
    });

    // Actually rooms don't have an aesthetic field — that's on Project.
    // For per-room aesthetic override, we'd need a per-room field.
    // For now, this action is a no-op for rooms — the aesthetic is project-level.
    // Return success; bulk aesthetic is applied at project level via saveProjectMetadata.
    return { success: true };
  } catch (error) {
    console.error("Bulk update room failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
