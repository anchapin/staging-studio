"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import type { ChecklistItem } from "@/lib/checklist-schema";
import {
  generatedCopySchema,
  roomCopyEditSchema,
  type RoomCopyEditInput,
} from "@/lib/room-copy-edit-schema";

export type CopyChecklistItem = ChecklistItem;

export type GeneratedCopy = {
  observedChallenge: string;
  buyerPsychology: string;
  recommendation: string;
  checklist: CopyChecklistItem[];
};

function failure(error: string): { success: false; error: string } {
  return { success: false, error };
}

export async function saveRoomCopy(
  roomId: string,
  generatedCopy: GeneratedCopy
): Promise<{ success: true } | { success: false; error: string }> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return failure("Not authenticated");
  }

  const ownershipCheck = await prisma.room.findFirst({
    where: { id: roomId, project: { userId: user.id } },
    select: { id: true },
  });
  if (!ownershipCheck) {
    return failure("Room not found");
  }

  const parsed = generatedCopySchema.safeParse(generatedCopy);
  if (!parsed.success) {
    return failure(
      parsed.error instanceof Error
        ? parsed.error.message
        : "Invalid generated copy"
    );
  }

  try {
    await prisma.room.update({
      where: { id: roomId },
      data: {
        observedChallenge: parsed.data.observedChallenge,
        buyerPsychology: parsed.data.buyerPsychology,
        recommendation: parsed.data.recommendation,
        checklistItems: parsed.data.checklist,
      },
    });
    revalidatePath(`/projects/[id]/rooms`, "page");
    return { success: true };
  } catch (err) {
    console.error("[saveRoomCopy]", err);
    return failure(err instanceof Error ? err.message : "Write failed");
  }
}

export async function saveRoomCopyEdits(
  roomId: string,
  edits: RoomCopyEditInput
): Promise<{ success: true } | { success: false; error: string }> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return failure("Not authenticated");
  }

  const ownershipCheck = await prisma.room.findFirst({
    where: { id: roomId, project: { userId: user.id } },
    select: { id: true },
  });
  if (!ownershipCheck) {
    return failure("Room not found");
  }

  const parsed = roomCopyEditSchema.safeParse(edits);
  if (!parsed.success) {
    return failure(
      parsed.error instanceof Error
        ? parsed.error.message
        : "Invalid room copy edits"
    );
  }

  try {
    await prisma.room.update({
      where: { id: roomId },
      data: {
        observedChallenge: parsed.data.observedChallenge,
        buyerPsychology: parsed.data.buyerPsychology,
        recommendation: parsed.data.recommendation,
        checklistItems: parsed.data.checklistItems,
      },
    });
    revalidatePath(`/projects/[id]/rooms`, "page");
    return { success: true };
  } catch (err) {
    console.error("[saveRoomCopyEdits]", err);
    return failure(err instanceof Error ? err.message : "Write failed");
  }
}
