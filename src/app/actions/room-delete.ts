"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";
import { componentLogger } from "@/lib/logger";

const log = componentLogger("action:room-delete");

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

  const project = await prisma.project.findUnique({
    where: { id: projectId, userId: user.id },
    select: { id: true },
  });
  if (!project) {
    return failure("Project not found");
  }

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
    log.error({ type: "reorder_rooms_failed", projectId }, "Failed to reorder rooms");
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
    log.error({ type: "delete_room_failed", roomId }, "Failed to delete room");
    return failure(err instanceof Error ? err.message : "Unknown error");
  }
}
