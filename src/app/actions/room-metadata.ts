"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-auth";
import {
  roomMetadataSchema,
  type RoomMetadataInput,
} from "@/lib/metadata-schemas";

function failure(error: string): { success: false; error: string } {
  return { success: false, error };
}

export async function saveRoomMetadata(
  roomId: string,
  roomData: RoomMetadataInput
): Promise<{ success: boolean; error?: string }> {
  const parsed = roomMetadataSchema.safeParse(roomData);
  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ?? "Invalid room metadata payload"
    );
  }

  const user = await requireUser();
  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId: user.id } },
    select: { id: true },
  });
  if (!room) {
    return failure("Room not found");
  }

  try {
    await prisma.room.update({
      where: { id: roomId, project: { userId: user.id } },
      data: parsed.data,
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save room metadata:", error);
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}
