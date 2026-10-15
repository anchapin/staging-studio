/**
 * Issue #1342 — `resolveHelperText` (Inspector footer subline).
 *
 * Pure resolver for the 12px ink-subtle line the Inspector shows under
 * the Run button. Three branches, in priority order:
 *  1. Blocked reason wins (the helper doubles as the "why is Run
 *     disabled?" affordance — see `resolveStageBlockedReason`).
 *  2. `viewing === "original"` → "Result saves as Variant <targetSlot>".
 *  3. Otherwise (viewing is a variant) → "Touches up Variant <viewing>
 *     in place".
 *
 * Branch order matches the design's narrative: a disabled Run button
 * should always explain itself, so the block reason MUST win even when
 * the (viewing, targetSlot) tuple would have produced a meaningful
 * subline.
 *
 * Pinned by `tests/edit-room-helper-text.test.ts` (one test per branch
 * + edge cases for empty blockedReason and the "blocked beats viewing"
 * rule).
 */

import type { SlotId } from "@/lib/edit-room-scope";

export interface HelperTextInputs {
  viewing: SlotId;
  /** Where the next run will land (per `resolveTargetSlot`). */
  targetSlot: SlotId;
  /**
   * The blocked resolver's return (`resolveStageBlockedReason`); null
   * means the run is allowed. An empty string is treated as no block
   * so a future refactor that returns "" instead of null doesn't
   * silently surface an empty helper.
   */
  blockedReason: string | null;
}

/**
 * Returns the line of text the Inspector renders below the Run button.
 * Never throws; never returns an empty string.
 */
export function resolveHelperText({
  viewing,
  targetSlot,
  blockedReason,
}: HelperTextInputs): string {
  if (blockedReason && blockedReason.length > 0) {
    return blockedReason;
  }
  if (viewing === "original") {
    return `Result saves as Variant ${targetSlot}`;
  }
  return `Touches up Variant ${viewing} in place`;
}