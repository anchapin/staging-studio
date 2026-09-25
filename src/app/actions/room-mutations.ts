"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";
import { componentLogger } from "@/lib/logger";

const log = componentLogger("action:room-mutations");

export async function bulkUpdateRoomAesthetic(
  roomIds: string[],
  aesthetic: string
): Promise<{ success: boolean; error?: string }> {
  if (!Array.isArray(roomIds) || roomIds.length === 0) {
    return { success: false, error: "No rooms provided" };
  }

  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const rooms = await prisma.room.findMany({
      where: { id: { in: roomIds } },
      select: { id: true, projectId: true, project: { select: { userId: true } } },
    });

    const invalid = rooms.filter((r) => r.project.userId !== user.id);
    if (invalid.length > 0) {
      return { success: false, error: "Some rooms are not owned by you" };
    }

    const projectIds = [...new Set(rooms.map((r) => r.projectId))];

    await prisma.project.updateMany({
      where: { id: { in: projectIds } },
      data: { stagingAesthetic: aesthetic },
    });

    for (const room of rooms) {
      revalidatePath(`/projects/${room.projectId}`);
    }

    return { success: true };
  } catch (error) {
    log.error({ type: "bulk_update_room_aesthetic_failed", roomCount: roomIds.length }, "Bulk update room aesthetic failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
