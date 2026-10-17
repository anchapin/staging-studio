"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser, requireProjectOwnershipSafe } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";
import {
  extractStoragePathFromUrl,
  isReclaimableRoomStoragePath,
  removeStorageObjects,
} from "@/lib/storage-cleanup";

function failure(error: string): { success: false; error: string } {
  return { success: false, error };
}

export async function reorderRooms(
  projectId: string,
  roomIds: string[]
): Promise<{ success: boolean; error?: string }> {
  if (!Array.isArray(roomIds) || roomIds.length === 0) {
    return failure("roomIds must be a non-empty array");
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return failure("Not authenticated");
  }

  const ownership = await requireProjectOwnershipSafe(projectId, user.id, prisma);
  if (!ownership) {
    return failure("Project not found");
  }

  try {
    // Issue #1147: the old fan-out committed N independent updates, so one
    // failure left a mix of old and new indexes and duplicate sortOrder
    // values. Commit all-or-nothing instead, and drop duplicate ids (a
    // duplicate would otherwise receive two conflicting indexes). update()
    // rather than updateMany() so a room deleted mid-reorder throws and
    // rolls the whole transaction back instead of matching zero rows.
    const uniqueRoomIds = Array.from(new Set(roomIds));
    await prisma.$transaction(async (tx) =>
      Promise.all(
        uniqueRoomIds.map((roomId, index) =>
          tx.room.update({
            where: { id: roomId, projectId },
            data: { sortOrder: index },
          })
        )
      )
    );
    return { success: true };
  } catch (err) {
    console.error("[reorderRooms]", err);
    return failure(err instanceof Error ? err.message : "Unknown error");
  }
}

export async function deleteRoom(
  roomId: string
): Promise<{ success: boolean; error?: string }> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return failure("Not authenticated");
  }

  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId: user.id } },
    select: { id: true, projectId: true },
  });
  if (!room) {
    return failure("Room not found");
  }

  // #1145: collect the storage objects this room references (its four
  // image columns plus inpaint-version thumbnails) BEFORE the row is
  // gone, so the paths are extractable from the URLs.
  const roomImages = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      beforeImageUrl: true,
      afterImageUrl: true,
      beforeImageUrl2: true,
      afterImageUrl2: true,
      inpaintVersions: { select: { thumbnailUrl: true } },
    },
  });
  const candidateUrls = roomImages
    ? [
        roomImages.beforeImageUrl,
        roomImages.afterImageUrl,
        roomImages.beforeImageUrl2,
        roomImages.afterImageUrl2,
        ...roomImages.inpaintVersions
          .map((v: { thumbnailUrl: string | null }) => v.thumbnailUrl)
          .filter((u): u is string => Boolean(u)),
      ]
    : [];
  const storagePaths = candidateUrls
    .filter((url): url is string => Boolean(url))
    .map((url) => extractStoragePathFromUrl(url))
    .filter((p): p is string => Boolean(p))
    .filter((p) => isReclaimableRoomStoragePath(p, roomId, room.projectId));
  const uniquePaths = Array.from(new Set(storagePaths));

  try {
    await prisma.room.delete({ where: { id: roomId } });
    // #1145: reclaim the room's room-photos / batch-rooms/** objects
    // after the DB delete commits. Best-effort: a storage failure is
    // logged, never fails the delete — an orphan is recoverable, a
    // lost room is not.
    if (uniquePaths.length > 0) {
      try {
        await removeStorageObjects(uniquePaths);
      } catch (cleanupErr) {
        // #1145: best-effort by contract. An orphaned object is
        // recoverable by a future sweep; a failed delete is not.
        console.error("[deleteRoom] storage cleanup failed", cleanupErr);
      }
    }
    revalidatePath(`/projects/${room.projectId}/rooms`);
    revalidatePath(`/preview/${room.projectId}`);
    return { success: true };
  } catch (err) {
    console.error("[deleteRoom]", err);
    return failure(err instanceof Error ? err.message : "Unknown error");
  }
}
