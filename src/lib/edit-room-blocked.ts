/**
 * Issue #1337 — `<EditRoomStudio>` shell, scope/view state machine.
 *
 * Pure "why is Run disabled?" resolver. The single source of truth for
 * the inline `blocked` string the Inspector renders under the primary
 * Run button (slice #1342 wires it up; this slice only pins the pure
 * function and the test that ships with #1337).
 *
 * Branch order matters: scope-specific reasons fire before the
 * universal "directions missing" guard. The case priority is
 * documented inline so a future reviewer can confirm the order in 30s.
 *
 * Pinned by `tests/edit-room-blocked.test.ts` (8 cases per the issue's
 * acceptance criteria).
 */

import type { EditRoomScope, SlotId } from "@/lib/edit-room-scope";

export interface StageBlockedInputs {
  scope: EditRoomScope;
  viewing: SlotId;
  hasMask: boolean;
  selectedCount: number;
  hasDirections: boolean;
}

/**
 * Returns the inline reason string the Run button shows when disabled,
 * or `null` when the run is allowed. Order of checks matches the
 * Magic Patterns design's inspector narrative:
 *   1. Whole-room runs must start from the original photo (touch-ups
 *      are an "objects" or "paint" choice).
 *   2. Object picks need both a populated variant to pick from AND
 *      at least one selected detection.
 *   3. Paint scope requires a non-empty mask.
 *   4. Every scope requires directions (the universal guard).
 */
export function resolveStageBlockedReason({
  scope,
  viewing,
  hasMask,
  selectedCount,
  hasDirections,
}: StageBlockedInputs): string | null {
  if (scope === "whole-room" && viewing !== "original") {
    return "Whole-room staging starts from the original photo.";
  }
  if (scope === "objects" && viewing === "original") {
    return "The original photo is empty — there are no objects to pick.";
  }
  if (scope === "objects" && selectedCount === 0) {
    return "Pick at least one object on the photo.";
  }
  if (scope === "paint" && !hasMask) {
    return "Paint over the area you want to change.";
  }
  if (!hasDirections) {
    return "Add directions so the AI knows what to stage.";
  }
  return null;
}