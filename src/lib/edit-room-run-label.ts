/**
 * Issue #1342 — `resolveRunLabel` (primary Run button text).
 *
 * The Inspector's Run button is the only entry point the user has for
 * launching an inpaint run. Its label is the one piece of feedback
 * designers use to confirm what the next run will actually do, so
 * every (scope, selectedCount) combination is pinned by a unit test
 * (see `tests/edit-room-run-label.test.ts`).
 *
 * Branch rules:
 *  - When `isRunning`, the label collapses to "Working… NN%" — the
 *    button is in flight, so the (scope, selectedCount) detail is
 *    already settled and showing it again is just noise.
 *  - `whole-room` → "Stage whole room".
 *  - `objects` → "Restage N object(s)" with the singular/plural
 *    matching `selectedCount`. The function intentionally produces
 *    a label even at `selectedCount === 0`; the call site uses the
 *    blocked resolver to disable the button in that case.
 *  - `paint` → "Restage painted area".
 *
 * `viewing` is part of the input shape for forward-compat with #1344's
 * variant-aware label text (per-slot copy like "Restage Variant A");
 * the function currently ignores it. The signature mirrors the issue
 * body so the call site doesn't need a follow-up refactor when the
 * new label logic lands.
 */

import type { EditRoomScope, SlotId } from "@/lib/edit-room-scope";

export interface RunLabelInputs {
  scope: EditRoomScope;
  selectedCount: number;
  viewing: SlotId;
  isRunning: boolean;
  /** 0..100 — only used when `isRunning` is true. Defaults to 0. */
  progress?: number;
}

export interface RunLabelResult {
  label: string;
  isLoading: boolean;
}

/**
 * Pure resolver for the Run button's text + loading state. Never
 * throws — invalid inputs produce the closest sensible string (so
 * the call site can render unconditionally and let the blocked
 * resolver gate interactivity).
 */
export function resolveRunLabel({
  scope,
  selectedCount,
  viewing: _viewing,
  isRunning,
  progress = 0,
}: RunLabelInputs): RunLabelResult {
  if (isRunning) {
    return { label: `Working… ${progress}%`, isLoading: true };
  }

  if (scope === "whole-room") {
    return { label: "Stage whole room", isLoading: false };
  }

  if (scope === "objects") {
    const noun = selectedCount === 1 ? "object" : "objects";
    return { label: `Restage ${selectedCount} ${noun}`, isLoading: false };
  }

  // scope === "paint"
  return { label: "Restage painted area", isLoading: false };
}