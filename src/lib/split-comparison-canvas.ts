/**
 * Pure logic for the split before/after comparison canvas (issue #618).
 *
 * Brush Refinement Studio (Step 3) center canvas: the AI-staged After
 * image fills the frame as a background layer while the raw Before photo
 * sits in a percentage-width clipped foreground layer. A draggable
 * divider (starting at 42%) reveals more or less of the staged result.
 *
 * Pinned 1:1 by tests/split-comparison-canvas.test.ts, same pattern as
 * lib/workbench-layout.ts and lib/consultation-action-bar.ts.
 */

/**
 * Issue #618 spec: the divider starts at 42% so the Before (raw vacant
 * room) side reads as the dominant panel on first paint.
 */
export const INITIAL_SPLIT_PERCENT = 42;

export const MIN_SPLIT_PERCENT = 0;
export const MAX_SPLIT_PERCENT = 100;

/** Maximum version pills rendered in the bottom history bar ("Passes:"). */
export const MAX_VISIBLE_VERSION_PILLS = 3;

/**
 * Clamp a split position to the valid 0–100 range. Non-finite input
 * (NaN from a bad parse, null rect math, etc.) falls back to the
 * spec'd initial position so the canvas never renders an invalid width.
 */
export function clampSplitPercent(value: number): number {
  if (Number.isNaN(value)) return INITIAL_SPLIT_PERCENT;
  return Math.min(MAX_SPLIT_PERCENT, Math.max(MIN_SPLIT_PERCENT, value));
}

/**
 * Convert a pointer's clientX into a split percentage given the canvas
 * container's bounding rect. Coordinates outside the rect clamp to the
 * nearest edge; a degenerate (zero-width / unmeasured) rect falls back
 * to the initial 42%.
 */
export function splitPercentFromClientX(
  clientX: number,
  rect: { left: number; width: number }
): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(rect.left) || rect.width <= 0) {
    return INITIAL_SPLIT_PERCENT;
  }
  return clampSplitPercent(((clientX - rect.left) / rect.width) * 100);
}

/**
 * Width (as a % of the CLIP layer) the inner Before-image holder must
 * have so the Before photo stays pixel-aligned with the After photo
 * beneath it instead of squashing as the clip narrows:
 * holder = container / (split / 100) = 10000 / split.
 *
 * A split of 0 hides the layer entirely (width 0), so the degenerate
 * division is guarded to a harmless 100%.
 */
export function beforeLayerInnerWidthPercent(splitPercent: number): number {
  const split = clampSplitPercent(splitPercent);
  if (split <= MIN_SPLIT_PERCENT) return 100;
  return 10000 / split;
}

/** 0-based version index → "v1"-style pass label shown in the history bar. */
export function versionPillLabel(index: number): string {
  return `v${index + 1}`;
}

export interface VisibleVersionPill<T> {
  item: T;
  /** 0-based index into the full chronological version list. */
  index: number;
  label: string;
}

/**
 * Pick the version pills rendered in the bottom history bar: the most
 * recent `maxVisible` passes (chronological tail), so the bar always
 * shows the latest pass (e.g. 5 passes → v3 / v4 / v5).
 */
export function visibleVersionPills<T>(
  versions: readonly T[],
  maxVisible: number = MAX_VISIBLE_VERSION_PILLS
): VisibleVersionPill<T>[] {
  if (!Number.isFinite(maxVisible) || maxVisible <= 0 || versions.length === 0) {
    return [];
  }
  const start = Math.max(0, versions.length - Math.floor(maxVisible));
  const items: VisibleVersionPill<T>[] = [];
  for (let i = start; i < versions.length; i++) {
    items.push({ item: versions[i], index: i, label: versionPillLabel(i) });
  }
  return items;
}

export type SplitHistoryAction =
  | { type: "select"; id: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" };

export interface SplitHistoryState {
  /** All version ids in chronological order (oldest → newest). */
  order: readonly string[];
  /** Index into `order` of the currently shown pass. */
  cursor: number;
}

export const EMPTY_SPLIT_HISTORY: SplitHistoryState = { order: [], cursor: -1 };

/**
 * Pure reducer for the version history bar's undo / redo / reset cluster.
 *
 * - select: jump the cursor to a known version id (unknown ids are a no-op)
 * - undo: step one pass back (never below the first)
 * - redo: step one pass forward (never past the latest)
 * - reset: snap straight back to the latest pass
 */
export function nextSplitHistory(
  state: SplitHistoryState,
  action: SplitHistoryAction
): SplitHistoryState {
  const { order, cursor } = state;
  if (order.length === 0) return state;

  switch (action.type) {
    case "select": {
      const next = order.indexOf(action.id);
      return next === -1 || next === cursor ? state : { order, cursor: next };
    }
    case "undo": {
      return cursor > 0 ? { order, cursor: cursor - 1 } : state;
    }
    case "redo": {
      return cursor < order.length - 1 ? { order, cursor: cursor + 1 } : state;
    }
    case "reset": {
      return cursor !== order.length - 1 ? { order, cursor: order.length - 1 } : state;
    }
    default:
      return state;
  }
}

export function canUndoSplitHistory(state: SplitHistoryState): boolean {
  return state.cursor > 0;
}

export function canRedoSplitHistory(state: SplitHistoryState): boolean {
  return state.cursor >= 0 && state.cursor < state.order.length - 1;
}

export function activeVersionId(state: SplitHistoryState): string | null {
  return state.cursor >= 0 ? (state.order[state.cursor] ?? null) : null;
}

/**
 * Accessible name for the invisible range input that overlays the canvas
 * (keyboard/touch alternative to dragging the split handle).
 */
export function rangeAriaLabel(beforeLabel: string, afterLabel: string): string {
  return `${beforeLabel} / ${afterLabel} comparison divider position`;
}
