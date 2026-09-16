"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";

export type CopyChecklistItem = {
  item: string;
  category: "DIY/Declutter" | "Rental Inventory" | "Minor Repair";
  priority: "Critical" | "High" | "Standard";
};

export type GeneratedCopy = {
  observedChallenge: string;
  recommendation: string;
  buyerPsychology: string;
  checklist: CopyChecklistItem[];
};

type OwnedRoomWhere = {
  id: string;
  project: { userId: string };
};

async function getOwnedRoomWhere(roomId: string): Promise<OwnedRoomWhere | null> {
  const user = await getAuthedPrismaUser();
  if (!user) return null;
  return { id: roomId, project: { userId: user.id } };
}

function failure(error: string): { success: false; error: string } {
  return { success: false, error };
}

export async function saveRoomCopy(
  roomId: string,
  copy: GeneratedCopy
): Promise<{ success: boolean; error?: string }> {
  const ownershipWhere = await getOwnedRoomWhere(roomId);
  if (!ownershipWhere) {
    return failure("Not authenticated");
  }

  try {
    await prisma.room.update({
      where: ownershipWhere,
      data: {
        observedChallenge: copy.observedChallenge,
        recommendation: copy.recommendation,
        buyerPsychology: copy.buyerPsychology,
        checklistItems: copy.checklist,
      },
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save room copy:", error);
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}

export async function saveVariantSelection(
  roomId: string,
  variantIndex: number
): Promise<{ success: boolean; error?: string }> {
  if (variantIndex !== 0 && variantIndex !== 1) {
    return failure("Invalid variant index: must be 0 or 1");
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
    console.error("Failed to save variant selection:", error);
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}

export async function saveRoomMetadata(
  roomId: string,
  roomData: {
    name?: string;
    rawDirectives?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const ownershipWhere = await getOwnedRoomWhere(roomId);
  if (!ownershipWhere) {
    return failure("Not authenticated");
  }

  try {
    await prisma.room.update({
      where: ownershipWhere,
      data: roomData,
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save room metadata:", error);
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}
