"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

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
 * FIFO: the oldest version is deleted when the cap is exceeded.
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
    const supabase = await createSupabaseRequestClient();
    const ext = "jpg";
    thumbnailStoragePath = `rooms/${roomId}/versions/${variantSlot}/${Date.now()}.${ext}`;

    // Convert data URL to Blob
    const base64Response = await fetch(thumbnailDataUrl);
    const thumbnailBlob = await base64Response.blob();

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("room-photos")
      .upload(thumbnailStoragePath, thumbnailBlob, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError || !uploadData) {
      console.error("[inpaint-versions] thumbnail upload failed:", uploadError);
      // Non-fatal: continue without thumbnail
    } else {
      const { data: publicUrlData } = supabase.storage
        .from("room-photos")
        .getPublicUrl(thumbnailStoragePath);
      thumbnailPublicUrl = publicUrlData?.publicUrl ?? null;
    }
  }

  // Enforce FIFO cap: count existing versions for this slot
  const existingCount = await prisma.inpaintVersion.count({
    where: { roomId, variantSlot },
  });

  // Fetch oldest versions to delete if over cap
  if (existingCount >= MAX_VERSIONS_PER_VARIANT) {
    const oldestToDelete = await prisma.inpaintVersion.findMany({
      where: { roomId, variantSlot },
      orderBy: { createdAt: "asc" },
      take: existingCount - MAX_VERSIONS_PER_VARIANT + 1,
      select: { id: true, thumbnailUrl: true },
    });

    // Delete oldest rows
    await prisma.inpaintVersion.deleteMany({
      where: {
        id: { in: oldestToDelete.map((v) => v.id) },
      },
    });

    // Optionally delete thumbnail objects from storage (best-effort)
    if (oldestToDelete.length > 0) {
      const supabase = await createSupabaseRequestClient();
      const pathsToDelete = oldestToDelete
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
    }
  }

  // Create new version row
  const version = await prisma.inpaintVersion.create({
    data: {
      roomId,
      variantSlot,
      resultUrl,
      thumbnailUrl: thumbnailPublicUrl,
      seed: seed ?? null,
      promptDirectives: promptDirectives ?? null,
    },
  });

  return { success: true, versionId: version.id };
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
          project: { select: { userId: true } },
        },
      },
    },
  });

  if (!version || version.room.project.userId !== user.id) {
    return failure("Version not found or not owned by user");
  }

  const column =
    version.variantSlot === 0 ? "afterImageUrl" : "afterImageUrl2";

  await prisma.room.update({
    where: { id: version.roomId },
    data: { [column]: version.resultUrl },
  });

  revalidatePath(`/projects/${version.room.project.userId}`);
  return { success: true };
}
