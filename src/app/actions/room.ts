"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import type { ChecklistItem } from "@/lib/checklist-schema";
import type { RoomCopyEditInput } from "@/lib/room-copy-edit-schema";
import {
  resolveSelectionAfterDelete,
  touchUpCountsBySlot,
  type TouchUpRequestRow,
} from "@/lib/variant-legibility";
import type { StagedVariantPair } from "@/lib/staged-result";

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
    console.error(
      JSON.stringify({ event: "save_room_copy_failed", roomId }),
      error
    );
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}

/**
 * Server action: persists manual lookbook-copy edits onto a room
 * (issue #250).
 *
 * Purpose: writes only the fields the lookbook edit page sends — a
 * partial {@link RoomCopyEditInput} (subset of `observedChallenge`,
 * `recommendation`, `buyerPsychology`, `checklistItems`) produced by the
 * debounced autosave. Unlike {@link saveRoomCopy} (full verbatim write of
 * AI output), absent fields are left untouched so an autosave of one
 * field can never clobber the others.
 *
 * Contract: `edits` must already be validated by
 * `roomCopyEditSchema` at the caller (the action is a thin trusted
 * writer, matching the other actions in this file). Requires an
 * authenticated session whose Prisma user owns the room's project — the
 * update runs with an ownership `where` filter, so a foreign roomId
 * silently matches nothing and returns "Not authenticated" rather than
 * throwing or leaking existence. Failures are caught and reported,
 * never thrown.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session
 * cookie; performs a Prisma `room.update`; logs failures to
 * `console.error`. No path revalidation (callers refresh locally).
 *
 * @param roomId ID of the room to update.
 * @param edits Validated partial copy edits; only present fields are written.
 * @returns `{ success: true }` on write, or
 *   `{ success: false, error }` when unauthenticated or the update fails.
 */
export async function saveRoomCopyEdits(
  roomId: string,
  edits: RoomCopyEditInput
): Promise<{ success: boolean; error?: string }> {
  const ownershipWhere = await getOwnedRoomWhere(roomId);
  if (!ownershipWhere) {
    return failure("Not authenticated");
  }

  const data: Partial<{
    observedChallenge: string;
    recommendation: string;
    buyerPsychology: string;
    checklistItems: ChecklistItem[];
  }> = {};
  if (edits.observedChallenge !== undefined) {
    data.observedChallenge = edits.observedChallenge;
  }
  if (edits.recommendation !== undefined) {
    data.recommendation = edits.recommendation;
  }
  if (edits.buyerPsychology !== undefined) {
    data.buyerPsychology = edits.buyerPsychology;
  }
  if (edits.checklistItems !== undefined) {
    data.checklistItems = edits.checklistItems;
  }

  try {
    await prisma.room.update({ where: ownershipWhere, data });
    return { success: true };
  } catch (error) {
    console.error(
      JSON.stringify({ event: "save_room_copy_edits_failed", roomId }),
      error
    );
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}

/**
 * Server action: records which before/after variant the user selected.
 *
 * Purpose: writes `Room.selectedVariantIndex`, which the lookbook uses
 * to pick which staged image to print.
 *
 * Contract: `variantIndex` must be exactly 0, 1, or `null` (issue #192:
 * `null` = "Original" — no variant is selected for print; rejected
 * before the auth check, so invalid input fails fast). Requires an
 * authenticated session owning the room's project; ownership is enforced
 * in the update's `where` filter. Failures are caught and reported,
 * never thrown.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session
 * cookie; performs a Prisma `room.update`; logs failures to
 * `console.error`.
 *
 * @param roomId ID of the room to update.
 * @param variantIndex Selected variant: `0` (Variant A), `1` (Variant B),
 *   or `null` (Original — nothing staged is selected).
 * @returns `{ success: true }` on write, or
 *   `{ success: false, error }` on invalid input, unauthenticated
 *   caller, or failed update.
 */
export async function saveVariantSelection(
  roomId: string,
  variantIndex: number | null
): Promise<{ success: boolean; error?: string }> {
  if (variantIndex !== null && variantIndex !== 0 && variantIndex !== 1) {
    return failure("Invalid variant index: must be null (Original), 0, or 1");
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

/**
 * Server action: counts each variant slot's touch-ups for a room.
 *
 * Purpose: feeds the "editing Variant X · n touch-ups" indicator
 * (issue #192). A touch-up is one `InpaintRequest` row that edited a
 * variant's staged result and landed back in the same slot
 * (`variantSlot === sourceSlot`); ERROR rows don't count. Derived purely
 * from existing rows — no schema change.
 *
 * Contract: requires an authenticated session owning the room's project;
 * the row query is scoped through `room` with the same ownership filter
 * as the mutations. Read-only — never writes.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session
 * cookie; performs one Prisma `findMany`; logs failures to
 * `console.error`.
 *
 * @param roomId ID of the room whose rows are counted.
 * @returns `{ success: true, counts }` with per-slot touch-up totals, or
 *   `{ success: false, error }` when unauthenticated or the query fails.
 */
export async function getVariantTouchUpCounts(
  roomId: string
): Promise<{
  success: boolean;
  counts?: { 0: number; 1: number };
  error?: string;
}> {
  const ownershipWhere = await getOwnedRoomWhere(roomId);
  if (!ownershipWhere) {
    return failure("Not authenticated");
  }

  try {
    const rows: TouchUpRequestRow[] = await prisma.inpaintRequest.findMany({
      where: { room: ownershipWhere },
      select: { variantSlot: true, sourceSlot: true, status: true },
    });
    return { success: true, counts: touchUpCountsBySlot(rows) };
  } catch (error) {
    console.error("Failed to count variant touch-ups:", error);
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}

/**
 * Server action: deletes one variant slot's staged after-image.
 *
 * Purpose: per-variant delete (issue #192) — clears `afterImageUrl` /
 * `afterImageUrl2` for the slot so it reads as "Not staged yet" in the
 * thumbnail strip and `pickVariantSlot` can land a fresh staging run
 * there again. The before photo and the other variant are untouched.
 *
 * Contract: `variantSlot` must be exactly 0 or 1 (rejected before the
 * auth check). Requires an authenticated session owning the room's
 * project; both the read and the update run with the ownership `where`
 * filter. Deleting a slot with no staged image fails explicitly.
 * Selection never dangles: when the deleted slot was selected, the
 * surviving complete variant is selected, else `selectedVariantIndex`
 * becomes `null` (Original) — resolution shared with the client's
 * optimistic update via `resolveSelectionAfterDelete`. Failures are
 * caught and reported, never thrown.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session
 * cookie; performs one Prisma `findUnique` + `room.update`; logs
 * failures to `console.error`. No path revalidation (callers refresh
 * locally).
 *
 * @param roomId ID of the room whose variant is deleted.
 * @param variantSlot Slot to clear: `0` (Variant A) or `1` (Variant B).
 * @returns `{ success: true }` on delete, or
 *   `{ success: false, error }` on invalid input, unauthenticated
 *   caller, missing room, empty slot, or failed update.
 */
export async function deleteVariantAfterImage(
  roomId: string,
  variantSlot: number
): Promise<{ success: boolean; error?: string }> {
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

    const afterUrl = variantSlot === 0 ? room.afterImageUrl : room.afterImageUrl2;
    if (!afterUrl) {
      return failure(
        `Variant ${variantSlot === 0 ? "A" : "B"} has no staged image to delete`
      );
    }

    const pairs: [StagedVariantPair, StagedVariantPair] = [
      { before: room.beforeImageUrl, after: room.afterImageUrl },
      { before: room.beforeImageUrl2, after: room.afterImageUrl2 },
    ];
    const nextSelection = resolveSelectionAfterDelete(
      pairs,
      room.selectedVariantIndex,
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
  } catch (error) {
    console.error("Failed to delete variant after-image:", error);
    return failure(error instanceof Error ? error.message : "Unknown error");
  }
}
