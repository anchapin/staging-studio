/**
 * Variant legibility (issue #192).
 *
 * The room keeps its two A/B variant slots (no history model before the
 * demo — Q7 decision); this module makes what exists legible:
 *
 * - `resolveStripSelection` — which item of the Original / Variant A /
 *   Variant B thumbnail strip is highlighted. The strip highlights the
 *   room's lookbook selection only while it points at a staged (complete)
 *   variant; anything else reads as "Original" — the source photo, i.e.
 *   no variant is selected for print.
 * - `resolveSelectionAfterDelete` — where `selectedVariantIndex` lands
 *   after a variant's after-image is deleted, so it never dangles on an
 *   empty slot: the surviving variant when it is complete, else `null`
 *   (Original).
 * - Touch-up accounting — a "touch-up" is one inpaint run that edited a
 *   variant's staged result and landed back in the same slot
 *   (`variantSlot === sourceSlot`). Original-photo runs (`sourceSlot:
 *   null`) are initial stagings, not touch-ups; ERROR rows changed
 *   nothing and don't count. Counts derive from existing `InpaintRequest`
 *   rows — no schema change.
 *
 * Pure logic, pinned 1:1 by `tests/variant-legibility.test.ts`.
 */

import {
  isCompleteVariantPair,
  type StagedVariantPair,
} from "@/lib/staged-result";
import type { InpaintSource, VariantSlot } from "@/lib/inpaint-source";

/** Which item of the variant thumbnail strip is highlighted. */
export type VariantStripSelection = "original" | VariantSlot;

/**
 * Resolves the strip's highlighted item from the room's raw
 * `selectedVariantIndex` (null → slot 0, per the column's default
 * semantics) and its two variant pairs.
 *
 * A variant is highlighted only when it is the selection AND complete;
 * every other state (fresh room, selection pointing at an unstaged slot)
 * highlights "Original" so the strip never implies an empty variant is
 * chosen for the lookbook.
 */
export function resolveStripSelection(
  selectedIndexRaw: number | null,
  pairs: readonly [StagedVariantPair, StagedVariantPair]
): VariantStripSelection {
  const index: VariantSlot = selectedIndexRaw === 1 ? 1 : 0;
  return isCompleteVariantPair(pairs[index]) ? index : "original";
}

/**
 * Resolves `selectedVariantIndex` after deleting `deletedSlot`'s
 * after-image.
 *
 * Contract:
 * - Deleting the NON-selected slot leaves the selection untouched
 *   (returned verbatim, including `null`).
 * - Deleting the selected slot lands on the other slot when it is a
 *   complete pair, else `null` — "Original" — so the value never points
 *   at a slot whose after-image no longer exists.
 *
 * Pure; the server action and the client's optimistic update both call
 * this so they cannot disagree.
 */
export function resolveSelectionAfterDelete(
  pairs: readonly [StagedVariantPair, StagedVariantPair],
  selectedIndexRaw: number | null,
  deletedSlot: VariantSlot
): number | null {
  const current: VariantSlot = selectedIndexRaw === 1 ? 1 : 0;
  if (current !== deletedSlot) {
    return selectedIndexRaw;
  }
  const other: VariantSlot = deletedSlot === 0 ? 1 : 0;
  return isCompleteVariantPair(pairs[other]) ? other : null;
}

/** The `InpaintRequest` fields touch-up accounting needs. */
export interface TouchUpRequestRow {
  variantSlot: number;
  sourceSlot: number | null;
  status: string;
}

/**
 * Counts the touch-ups on one variant slot from the room's
 * `InpaintRequest` rows: variant-source runs (sourceSlot === slot) whose
 * result landed in that same slot, excluding ERROR rows (they changed
 * nothing). In-flight rows (IN_QUEUE / IN_PROGRESS) count — the touch-up
 * is being applied.
 */
export function countVariantTouchUps(
  rows: readonly TouchUpRequestRow[],
  slot: VariantSlot
): number {
  return rows.filter(
    (row) =>
      row.variantSlot === slot &&
      row.sourceSlot === slot &&
      row.status !== "ERROR"
  ).length;
}

/** Per-slot touch-up counts in one pass over the rows. */
export function touchUpCountsBySlot(
  rows: readonly TouchUpRequestRow[]
): { 0: number; 1: number } {
  return {
    0: countVariantTouchUps(rows, 0),
    1: countVariantTouchUps(rows, 1),
  };
}

/**
 * The variant slot currently being edited, for the "editing Variant X ·
 * n touch-ups" indicator: the editor's chosen source when it is a staged
 * variant, otherwise a resuming pending run that edits a variant.
 * `null` when no variant-editing is in play (original-photo mode with
 * nothing pending).
 */
export function resolveActiveEditingSlot(
  source: InpaintSource,
  pendingSource: InpaintSource | null
): VariantSlot | null {
  if (source.kind === "variant") return source.slot;
  if (pendingSource?.kind === "variant") return pendingSource.slot;
  return null;
}

/**
 * Visible text for the editing indicator. Zero (or unknown) touch-ups
 * renders without the count suffix — an in-flight first touch-up hasn't
 * landed yet, so "· 0 touch-ups" would read as a bug.
 */
export function variantTouchUpLabel(slot: VariantSlot, touchUps: number): string {
  const letter = slot === 1 ? "B" : "A";
  if (touchUps < 1) return `Editing Variant ${letter}`;
  return `Editing Variant ${letter} · ${touchUps} touch-up${touchUps === 1 ? "" : "s"}`;
}
