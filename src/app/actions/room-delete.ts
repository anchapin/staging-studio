"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";

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
    console.error("[reorderRooms]", err);
    return failure(err instanceof Error ? err.message : "Unknown error");
  }
}
