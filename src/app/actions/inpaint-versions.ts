"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { validateThumbnailDataUrl } from "@/lib/thumbnail-data-url";
import {
  fifoEvictionTake,
  versionThumbnailStoragePath,
} from "@/lib/inpaint-version-storage";
import { revalidatePath } from "next/cache";
import { componentLogger } from "@/lib/logger";

const log = componentLogger("action:inpaint-versions");

const MAX_VERSIONS_PER_VARIANT = 20;

type ActionFailure = { success: false; error: string };

function failure(error: string): ActionFailure {
  return { success: false, error };
}

/**
 * Saves a new inpaint version for a room's variant slot.
 *
 * On save: uploads the thumbnail to Supabase Storage, then creates the
 * InpaintVersion row. Enforces MAX_VERSIONS_PER_VARIANT (20) per slot using
 * FIFO: the oldest version is deleted when the cap is exceeded. The cap
 * check and insert run inside one transaction, serialized per room by a
 * SELECT … FOR UPDATE on the room row (issue #700).
 *
 * Contract: requires authenticated session owning the room's project.
 *
 * @param roomId       Room the version belongs to.
 * @param variantSlot   0 or 1 — which variant slot.
 * @param resultUrl     Full-resolution result image URL (from fal/staging-images).
 * @param thumbnailDataUrl  Base64 data URL of the thumbnail (generated client-side).
 * @param seed         Optional fal.ai seed for this run.
 * @param promptDirectives Optional staging directives used.
 */
export async function saveInpaintVersion({
  roomId,
  variantSlot,
  resultUrl,
  thumbnailDataUrl,
  seed,
  promptDirectives,
}: {
  roomId: string;
  variantSlot: 0 | 1;
  resultUrl: string;
  thumbnailDataUrl: string;
  seed?: string;
  promptDirectives?: string;
}): Promise<{ success: true; versionId: string } | ActionFailure> {
  const user = await getAuthedPrismaUser();
  if (!user) return failure("Not authenticated");

  // Ownership check
  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId: user.id } },
    select: { id: true },
  });
  if (!room) return failure("Room not found or not owned by user");

  // Upload thumbnail to Supabase Storage
  let thumbnailStoragePath: string | null = null;
  let thumbnailPublicUrl: string | null = null;

  if (thumbnailDataUrl) {
    const thumbnailCheck = validateThumbnailDataUrl(thumbnailDataUrl);
    if (!thumbnailCheck.ok) return failure(thumbnailCheck.error);

    const supabase = await createSupabaseRequestClient();
    // Issue #700: the key ends in a random UUID, so two saves landing in the
    // same millisecond can never overwrite each other's thumbnail object.
    // Uploads are plain creates (upsert removed) — a key collision must be a
    // loud error, not a silent overwrite of another version's image.
    thumbnailStoragePath = versionThumbnailStoragePath(roomId, variantSlot);

    // Convert data URL to Blob
    const base64Response = await fetch(thumbnailDataUrl);
    const thumbnailBlob = await base64Response.blob();

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("room-photos")
      .upload(thumbnailStoragePath, thumbnailBlob, {
        contentType: "image/jpeg",
      });

    if (uploadError || !uploadData) {
      log.error({ type: "thumbnail_upload_failed", roomId, variantSlot }, "Thumbnail upload failed (continuing without thumbnail)");
      // Non-fatal: continue without thumbnail
    } else {
      const { data: publicUrlData } = supabase.storage
        .from("room-photos")
        .getPublicUrl(thumbnailStoragePath);
      thumbnailPublicUrl = publicUrlData?.publicUrl ?? null;
    }
  }

  // Issue #700: the FIFO cap check and the insert must run as ONE atomic
  // read-modify-write. Previously count → deleteMany → create were separate
  // queries, so two concurrent completions could both count 19/20 and both
  // insert past the cap, or a failed create could leave the deleteMany
  // committed — losing the oldest versions without recording the new one.
  // The SELECT … FOR UPDATE on the room row serializes racing savers for the
  // same room; the surrounding transaction keeps eviction + insert atomic.
  try {
    const { version, evicted } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;

      const existingCount = await tx.inpaintVersion.count({
        where: { roomId, variantSlot },
      });

      let evicted: Array<{ id: string; thumbnailUrl: string | null }> = [];
      const evictCount = fifoEvictionTake(
        existingCount,
        MAX_VERSIONS_PER_VARIANT
      );

      if (evictCount > 0) {
        evicted = await tx.inpaintVersion.findMany({
          where: { roomId, variantSlot },
          orderBy: { createdAt: "asc" },
          take: evictCount,
          select: { id: true, thumbnailUrl: true },
        });

        await tx.inpaintVersion.deleteMany({
          where: {
            id: { in: evicted.map((v) => v.id) },
          },
        });
      }

      const version = await tx.inpaintVersion.create({
        data: {
          roomId,
          variantSlot,
          resultUrl,
          thumbnailUrl: thumbnailPublicUrl,
          seed: seed ?? null,
          promptDirectives: promptDirectives ?? null,
        },
      });

      return { version, evicted };
    });

    // Best-effort cleanup of evicted thumbnails AFTER the transaction
    // commits — storage failures must never lose the version rows.
    if (evicted.length > 0) {
      try {
        const supabase = await createSupabaseRequestClient();
        const pathsToDelete = evicted
          .map((v) => v.thumbnailUrl)
          .filter((url): url is string => Boolean(url))
          .map((url) => {
            try {
              const u = new URL(url);
              // Extract the storage path from the public URL
              // Public URL format: https://xxx.supabase.co/storage/v1/object/public/room-photos/rooms/...
              const pathParts = u.pathname.split("/storage/v1/object/public/");
              return pathParts[1] ?? null;
            } catch {
              return null;
            }
          })
          .filter((p): p is string => Boolean(p));

        if (pathsToDelete.length > 0) {
          await supabase.storage.from("room-photos").remove(pathsToDelete);
        }
      } catch (cleanupError) {
        log.error({ type: "evicted_thumbnail_cleanup_failed", roomId, variantSlot }, "Evicted thumbnail cleanup failed");
      }
    }

    return { success: true, versionId: version.id };
  } catch (error) {
    log.error({ type: "save_inpaint_version_failed", roomId, variantSlot }, "Failed to save inpaint version");
    return failure("Failed to save version");
  }
}

/**
 * Fetches all inpaint versions for a room's variant slot, newest first.
 */
export async function getInpaintVersions(
  roomId: string,
  variantSlot: 0 | 1
): Promise<
  | {
      success: true;
      versions: Array<{
        id: string;
        resultUrl: string;
        thumbnailUrl: string | null;
        seed: string | null;
        promptDirectives: string | null;
        createdAt: Date;
      }>;
    }
  | ActionFailure
> {
  const user = await getAuthedPrismaUser();
  if (!user) return failure("Not authenticated");

  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId: user.id } },
    select: { id: true },
  });
  if (!room) return failure("Room not found or not owned by user");

  const versions = await prisma.inpaintVersion.findMany({
    where: { roomId, variantSlot },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      resultUrl: true,
      thumbnailUrl: true,
      seed: true,
      promptDirectives: true,
      createdAt: true,
    },
  });

  return { success: true, versions };
}

/**
 * Restores a specific inpaint version by setting the room's afterImageUrl
 * (or afterImageUrl2) to that version's resultUrl.
 */
export async function restoreInpaintVersion(
  versionId: string
): Promise<{ success: true } | ActionFailure> {
  const user = await getAuthedPrismaUser();
  if (!user) return failure("Not authenticated");

  const version = await prisma.inpaintVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      roomId: true,
      variantSlot: true,
      resultUrl: true,
      room: {
        select: {
          id: true,
          project: { select: { id: true, userId: true, clientSignatureStatus: true } },
        },
      },
    },
  });

  if (!version || version.room.project.userId !== user.id) {
    return failure("Version not found or not owned by user");
  }

  if (version.room.project.clientSignatureStatus === "Signed") {
    return failure("Cannot restore a version on a signed project");
  }

  const column =
    version.variantSlot === 0 ? "afterImageUrl" : "afterImageUrl2";

  await prisma.room.update({
    where: { id: version.roomId },
    data: { [column]: version.resultUrl },
  });

  const projectId = version.room.project.id;
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/lookbook`);
  return { success: true };
}
