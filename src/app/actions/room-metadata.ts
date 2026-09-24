"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  roomMetadataSchema,
  type RoomMetadataInput,
} from "@/lib/metadata-schemas";

function failure(error: string): { success: false; error: string } {
  return { success: false, error };
}

async function getOwnedRoomWhere(roomId: string) {
  const user = await getAuthedPrismaUser();
  if (!user) return null;
  return { id: roomId, project: { userId: user.id } } as const;
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

  const ownershipWhere = await getOwnedRoomWhere(roomId);
  if (!ownershipWhere) {
    return failure("Not authenticated");
  }

  try {
    await prisma.room.update({
      where: ownershipWhere,
      data: parsed.data,
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save room metadata:", error);
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}
