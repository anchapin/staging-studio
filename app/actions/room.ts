"use server";

import { prisma } from "@/lib/prisma";

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

export async function saveRoomCopy(
  roomId: string,
  copy: GeneratedCopy
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.room.update({
      where: { id: roomId },
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
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
