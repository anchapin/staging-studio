"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { setActiveVariant } from "@/lib/room-variant-service";
import {
  resolveSelectionAfterDelete,
  touchUpCountsBySlot,
  type TouchUpRequestRow,
} from "@/lib/variant-legibility";
import type { StagedVariantPair } from "@/lib/staged-result";

function failure(error: string): { success: false; error: string } {
  return { success: false, error };
}

async function getOwnedRoomWhere(roomId: string) {
  const user = await getAuthedPrismaUser();
  if (!user) return null;
  return { id: roomId, project: { userId: user.id } } as const;
}

export async function saveVariantSelection(
  roomId: string,
  variantIndex: number | null
): Promise<{ success: boolean; error?: string }> {
  const validated = setActiveVariant({ selectedVariantIndex: variantIndex } as never, variantIndex);
  if (validated === null && variantIndex !== null) {
    return failure(
      "Invalid variant index: must be null (Original), 0, or 1"
    );
  }

  const ownershipWhere = await getOwnedRoomWhere(roomId);
  if (!ownershipWhere) {
    return failure("Not authenticated");
  }

  try {
    await prisma.room.update({
      where: ownershipWhere,
      data: { selectedVariantIndex: variantIndex },
    });
    return { success: true };
  } catch (error) {
    console.error("[saveVariantSelection]", error);
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}

export async function getVariantTouchUpCounts(
  roomId: string
): Promise<{ success: boolean; counts?: { 0: number; 1: number }; error?: string }> {
  const ownershipWhere = await getOwnedRoomWhere(roomId);
  if (!ownershipWhere) {
    return failure("Not authenticated");
  }

  try {
    const rows = await prisma.inpaintRequest.findMany({
      where: { roomId, status: "succeeded" },
      select: { id: true, status: true, variantSlot: true, sourceSlot: true },
      orderBy: { createdAt: "asc" },
    });

    return { success: true, counts: touchUpCountsBySlot(rows as TouchUpRequestRow[]) };
  } catch (err) {
    console.error("[getVariantTouchUpCounts]", err);
    return failure(err instanceof Error ? err.message : "Query failed");
  }
}

export async function deleteVariantAfterImage(
  roomId: string,
  variantSlot: number
): Promise<{ success: true } | { success: false; error: string }> {
  if (variantSlot !== 0 && variantSlot !== 1) {
    return failure("Invalid variant slot: must be 0 or 1");
  }

  const ownershipWhere = await getOwnedRoomWhere(roomId);
  if (!ownershipWhere) {
    return failure("Not authenticated");
  }

  try {
    const room = await prisma.room.findUnique({
      where: ownershipWhere,
      select: {
        beforeImageUrl: true,
        afterImageUrl: true,
        beforeImageUrl2: true,
        afterImageUrl2: true,
        selectedVariantIndex: true,
      },
    });

    if (!room) {
      return failure("Room not found");
    }

    const slotAfterImage =
      variantSlot === 0 ? room.afterImageUrl : room.afterImageUrl2;
    if (!slotAfterImage) {
      return failure("Slot already empty");
    }

    const pairs: [StagedVariantPair, StagedVariantPair] = [
      { before: room.beforeImageUrl ?? "", after: room.afterImageUrl ?? "" },
      { before: room.beforeImageUrl2 ?? "", after: room.afterImageUrl2 ?? "" },
    ];

    const nextSelection = resolveSelectionAfterDelete(
      pairs,
      room.selectedVariantIndex ?? 0,
      variantSlot
    );

    await prisma.room.update({
      where: ownershipWhere,
      data:
        variantSlot === 0
          ? { afterImageUrl: null, selectedVariantIndex: nextSelection }
          : { afterImageUrl2: null, selectedVariantIndex: nextSelection },
    });

    return { success: true };
  } catch (err) {
    console.error("[deleteVariantAfterImage]", err);
    return failure(err instanceof Error ? err.message : "Unknown error");
  }
}
