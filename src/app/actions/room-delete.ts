"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser, requireProjectOwnershipSafe } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";

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

  try {
    await prisma.room.delete({ where: { id: roomId } });
    revalidatePath(`/projects/${room.projectId}/rooms`);
    return { success: true };
  } catch (err) {
    console.error("[deleteRoom]", err);
    return failure(err instanceof Error ? err.message : "Unknown error");
  }
}
