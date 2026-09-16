"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import type { ChecklistItem } from "@/lib/checklist-schema";

/** Re-export of {@link ChecklistItem}; the AI copy payload's checklist entry. */
export type CopyChecklistItem = ChecklistItem;

/**
 * AI-generated room copy payload produced by `POST /api/generate-copy`
 * and persisted by {@link saveRoomCopy}. Shape mirrors the `Room` AI
 * output columns.
 */
export type GeneratedCopy = {
  /** The staging challenge observed in the room photo. */
  observedChallenge: string;
  /** The staging recommendation prose for the lookbook. */
  recommendation: string;
  /** Buyer-psychology rationale paragraph. */
  buyerPsychology: string;
  /** Pre-listing checklist items (see `lib/checklist-schema.ts`). */
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

/**
 * Server action: persists AI-generated copy onto a room.
 *
 * Purpose: writes the `POST /api/generate-copy` output (see
 * {@link GeneratedCopy}) to the `Room` AI columns: `observedChallenge`,
 * `recommendation`, `buyerPsychology`, and `checklistItems` (JSON).
 *
 * Contract: requires an authenticated session whose Prisma user owns the
 * room's project — the update runs with an ownership `where` filter
 * (`id: roomId, project: { userId }`), so a foreign roomId silently
 * matches nothing and returns "Not authenticated" rather than throwing.
 * All other failures are caught and reported; nothing throws to the
 * client.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session
 * cookie; performs a Prisma `room.update`; logs failures to
 * `console.error`. No path revalidation (callers refresh locally).
 *
 * @param roomId ID of the room to update.
 * @param copy Generated copy to persist (all fields written verbatim).
 * @returns `{ success: true }` on write, or
 *   `{ success: false, error }` when unauthenticated or the update fails.
 */
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

/**
 * Server action: records which before/after variant the user selected.
 *
 * Purpose: writes `Room.selectedVariantIndex`, which the lookbook uses
 * to pick which staged image to print.
 *
 * Contract: `variantIndex` must be exactly 0 or 1 (rejected before the
 * auth check, so invalid input fails fast). Requires an authenticated
 * session owning the room's project; ownership is enforced in the
 * update's `where` filter. Failures are caught and reported, never
 * thrown.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session
 * cookie; performs a Prisma `room.update`; logs failures to
 * `console.error`.
 *
 * @param roomId ID of the room to update.
 * @param variantIndex Selected variant: `0` (primary) or `1` (alternate).
 * @returns `{ success: true }` on write, or
 *   `{ success: false, error }` on invalid input, unauthenticated
 *   caller, or failed update.
 */
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

/**
 * Server action: updates editable room fields (name and/or raw AI
 * directives).
 *
 * Purpose: powers the canvas editor's inline room metadata edits.
 * Only the fields present in `roomData` are written; `undefined` values
 * are ignored by Prisma, never nulled out.
 *
 * Contract: requires an authenticated session owning the room's project;
 * ownership is enforced in the update's `where` filter. Failures are
 * caught and reported, never thrown.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session
 * cookie; performs a Prisma `room.update`; logs failures to
 * `console.error`. No path revalidation.
 *
 * @param roomId ID of the room to update.
 * @param roomData Partial fields: `name` (display name) and/or
 *   `rawDirectives` (free-form staging instructions fed to the AI).
 * @returns `{ success: true }` on write, or
 *   `{ success: false, error }` when unauthenticated or the update fails.
 */
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
