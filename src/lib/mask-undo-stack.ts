/**
 * Pure undo/redo history for the inpaint mask editor (issue #694).
 *
 * `inpaint-mask-canvas.tsx` captures the mask canvas as a PNG data-URL
 * snapshot BEFORE each destructive operation (brush stroke, fill, clear,
 * paste) and restores the latest snapshot on undo (Undo button or
 * Cmd/Ctrl+Z). That stack logic used to live inline in the 1,700-line
 * component with zero test coverage; it is extracted here unchanged in
 * behavior so it can be pinned 1:1 by `tests/mask-undo-stack.test.ts`.
 *
 * Semantics carried over from the component (issue #378):
 * - Snapshots are opaque serializable strings (canvas `toDataURL` output).
 * - A capture can fail (`null` when the canvas ref is missing); pushing
 *   `null` is a no-op, exactly like the old `if (undoState !== null)` guard.
 * - Undo pops the LATEST snapshot; undoing an empty stack is a no-op.
 *
 * Semantics added by this module (issue #694 acceptance criteria):
 * - `MAX_MASK_UNDO_DEPTH` caps the stack; the OLDEST snapshot is dropped
 *   first (the component's stack was unbounded, which risks unbounded
 *   memory growth — each entry is a full PNG data URL).
 * - Redo is supported for callers that pass the CURRENT canvas state to
 *   `undoMaskSnapshot`. The component does not: its UI exposes undo only,
 *   so it calls `undoMaskSnapshot(history)` with no current snapshot, which
 *   discards the popped entry and clears redo — byte-for-byte the old
 *   pop-and-forget behavior. Redo exists here as pure, tested logic for
 *   the day a redo affordance is added.
 * - A new push always invalidates the redo branch (classic editor rule).
 *
 * All functions are pure: they return new history objects and never
 * mutate their inputs.
 */

/** Maximum snapshots retained for undo. Oldest entries are dropped beyond this. */
export const MAX_MASK_UNDO_DEPTH = 50;

export interface MaskUndoHistory {
  /** Before-operation snapshots, oldest first; the last entry is the next undo target. */
  readonly undo: readonly string[];
  /** After-operation snapshots produced by redo-aware undo, newest first. Empty for undo-only callers. */
  readonly redo: readonly string[];
}

export function emptyMaskUndoHistory(): MaskUndoHistory {
  return { undo: [], redo: [] };
}

/** Explicitly drop all undo/redo history (e.g. when the underlying image changes). */
export function resetMaskUndoHistory(): MaskUndoHistory {
  return emptyMaskUndoHistory();
}

export function canUndoMask(history: MaskUndoHistory): boolean {
  return history.undo.length > 0;
}

/** Number of undo steps currently available (drives the Undo button count). */
export function maskUndoCount(history: MaskUndoHistory): number {
  return history.undo.length;
}

function capUndo(undo: readonly string[]): readonly string[] {
  if (undo.length <= MAX_MASK_UNDO_DEPTH) return undo;
  return undo.slice(undo.length - MAX_MASK_UNDO_DEPTH);
}

/**
 * Record a before-operation snapshot. `null` captures (canvas missing) are
 * no-ops. Pushing new work clears the redo branch, since the redo path is
 * no longer reachable after the canvas diverges from it.
 */
export function pushMaskSnapshot(
  history: MaskUndoHistory,
  snapshot: string | null
): MaskUndoHistory {
  if (snapshot === null) return history;
  return { undo: capUndo([...history.undo, snapshot]), redo: [] };
}

export interface MaskUndoResult {
  history: MaskUndoHistory;
  /** The snapshot to restore, or `null` when there is nothing to undo. */
  snapshot: string | null;
}

/**
 * Pop the latest snapshot for restoration.
 *
 * - `currentSnapshot` omitted (the component's usage): the popped entry is
 *   discarded and redo is cleared — exactly the pre-#694 behavior.
 * - `currentSnapshot` provided (redo-aware callers): it becomes the redo
 *   target, so a subsequent `redoMaskSnapshot` can restore it.
 */
export function undoMaskSnapshot(
  history: MaskUndoHistory,
  currentSnapshot?: string | null
): MaskUndoResult {
  if (history.undo.length === 0) return { history, snapshot: null };
  const snapshot = history.undo[history.undo.length - 1];
  const undo = history.undo.slice(0, -1);
  const redo =
    currentSnapshot != null ? capUndo([currentSnapshot, ...history.redo]) : [];
  return { history: { undo, redo }, snapshot };
}

/**
 * Restore the most recent redo target. Symmetric with redo-aware undo: the
 * caller passes the CURRENT canvas state so undoing again returns to the
 * pre-redo state. Returns `snapshot: null` when there is nothing to redo.
 */
export function redoMaskSnapshot(
  history: MaskUndoHistory,
  currentSnapshot: string | null
): MaskUndoResult {
  if (history.redo.length === 0) return { history, snapshot: null };
  const [snapshot, ...redo] = history.redo;
  const undo =
    currentSnapshot != null
      ? capUndo([...history.undo, currentSnapshot])
      : history.undo;
  return { history: { undo, redo }, snapshot };
}
