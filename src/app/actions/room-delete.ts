"use server";

import { prisma } from "@/lib/prisma";
import { requireUser, requireProjectOwnership } from "@/lib/api-auth";
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

  const user = await requireUser();
  await requireProjectOwnership(projectId, user.id);

  try {
    await Promise.all(
      roomIds.map((roomId, index) =>
        prisma.room.updateMany({
          where: { id: roomId, projectId },
          data: { sortOrder: index },
        })
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
  const user = await requireUser();
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
