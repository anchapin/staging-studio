"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import type { ChecklistItem } from "@/lib/checklist-schema";
import {
  generatedCopySchema,
  listingCopySchema,
  roomCopyEditSchema,
  type ListingCopyInput,
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
    const updated = await prisma.room.update({
      where: { id: roomId },
      data: {
        observedChallenge: parsed.data.observedChallenge,
        buyerPsychology: parsed.data.buyerPsychology,
        recommendation: parsed.data.recommendation,
        checklistItems: parsed.data.checklist,
      },
      select: { projectId: true },
    });
    revalidatePath(`/projects/[id]/rooms`, "page");
    revalidatePath(`/preview/${updated.projectId}`);
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
    const updated = await prisma.room.update({
      where: { id: roomId },
      data: {
        observedChallenge: parsed.data.observedChallenge,
        buyerPsychology: parsed.data.buyerPsychology,
        recommendation: parsed.data.recommendation,
        checklistItems: parsed.data.checklistItems,
      },
      select: { projectId: true },
    });
    revalidatePath(`/projects/[id]/rooms`, "page");
    revalidatePath(`/preview/${updated.projectId}`);
    return { success: true };
  } catch (err) {
    console.error("[saveRoomCopyEdits]", err);
    return failure(err instanceof Error ? err.message : "Write failed");
  }
}

/**
 * Issue #1343 — persist the redesigned CopyPanel's headline + body
 * onto the room's `lookbookHeadline` / `lookbookBody` columns.
 *
 * Called by the CopyPanel's `AutosaveController<ListingCopy>` on
 * every debounced edit. Both fields are always sent together (the
 * autosave controller always carries the full payload) — this keeps
 * the API edge surface single-shape and lets the autosave controller
 * remain pure 1:1 with `autosaveCopy`'s output shape.
 *
 * Authorization + ownership checks mirror `saveRoomCopy` /
 * `saveRoomCopyEdits`: session required, `Room.project.userId`
 * must match the authed user. The Zod layer (`listingCopySchema`)
 * enforces the 600-char body cap and rejects unknown keys; the
 * preview freshness contract (#1225) issues `revalidatePath` for
 * `/preview/${projectId}` alongside the lookbook dashboard path so
 * the next Browserless PDF export sees the new headline/body.
 *
 * Returns `{ success: true }` on success, `{ success: false, error }`
 * on failure — never throws (server-action errors render as
 * `error` state in the autosave controller, never a hard crash).
 */
export async function saveListingCopy(
  roomId: string,
  copy: ListingCopyInput
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

  const parsed = listingCopySchema.safeParse(copy);
  if (!parsed.success) {
    return failure(
      parsed.error instanceof Error
        ? parsed.error.message
        : "Invalid listing copy"
    );
  }

  try {
    const updated = await prisma.room.update({
      where: { id: roomId },
      data: {
        lookbookHeadline: parsed.data.lookbookHeadline,
        lookbookBody: parsed.data.lookbookBody,
      },
      select: { projectId: true },
    });
    // Issue #1225 — preview freshness contract: mutating a lookbook-
    // rendered field requires revalidation of /preview/[id] alongside
    // the dashboard path. The `revalidate-preview.test.ts` guard pins
    // every new server action that updates a field the print preview
    // renders.
    revalidatePath(`/projects/${updated.projectId}/lookbook`, "page");
    revalidatePath(`/preview/${updated.projectId}`);
    return { success: true };
  } catch (err) {
    console.error("[saveListingCopy]", err);
    return failure(err instanceof Error ? err.message : "Write failed");
  }
}
