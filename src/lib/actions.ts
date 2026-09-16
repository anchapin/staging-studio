"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function saveVariantSelection(
  roomId: string,
  variantIndex: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.room.update({
      where: { id: roomId },
      data: { selectedVariantIndex: variantIndex },
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save variant selection:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function saveGeneratedCopy(
  roomId: string,
  copyData: {
    observedChallenge?: string;
    recommendation?: string;
    buyerPsychology?: string;
    checklistItems?: unknown;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.room.update({
      where: { id: roomId },
      data: {
        observedChallenge: copyData.observedChallenge,
        recommendation: copyData.recommendation,
        buyerPsychology: copyData.buyerPsychology,
        checklistItems: copyData.checklistItems as object,
      },
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save generated copy:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function saveProjectMetadata(
  projectId: string,
  metadata: {
    propertyAddress?: string;
    clientName?: string;
    targetBuyer?: string;
    stagingAesthetic?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.project.update({
      where: { id: projectId },
      data: metadata,
    });
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to save project metadata:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function saveRoomMetadata(
  roomId: string,
  roomData: {
    name?: string;
    rawDirectives?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.room.update({
      where: { id: roomId },
      data: roomData,
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to save room metadata:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
