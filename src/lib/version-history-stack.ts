/**
 * Pure undo/redo stack state machine for the version-history pills
 * (src/components/canvas/version-history-pills.tsx). Issue #699.
 *
 * The pills keep three pieces of selection state — an undo stack and a redo
 * stack of result URLs (last element = most recent) plus the index of the
 * currently selected version in the newest-first versions array. Restores
 * mutate that state optimistically while the server call is in flight and
 * roll back to the pre-click snapshot on failure, so the transition math
 * lives here where tests can pin it.
 *
 * Invariants (standard undo/redo discipline):
 * - undo pops the undo target and pushes the outgoing URL onto the redo
 *   stack WITHOUT clearing it — redo must stay possible after undo (#699:
 *   the shared restore path used to wipe the redo entry undo just seeded).
 * - redo mirrors that: the outgoing URL is pushed onto the undo stack
 *   exactly once, and the remaining undo history is preserved.
 * - only a *direct* restore (a pill click outside the undo/redo flow)
 *   clears the redo stack: a new action invalidates the redo history.
 */

export interface VersionHistoryStackState {
  /** Result URLs available to undo; last element is the most recent. */
  undoStack: string[];
  /** Result URLs available to redo; last element is the most recent. */
  redoStack: string[];
  /** Index of the current selection in the newest-first versions array. */
  currentIndex: number;
}

export type VersionRestoreIntent =
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "direct"; targetIndex: number };

export interface VersionRestorePlan {
  /** URL of the version this restore switches to. */
  targetUrl: string;
  /** Index of the target version in the newest-first versions array. */
  targetIndex: number;
  /**
   * State to apply optimistically while the restore is in flight
   * (`next.currentIndex === targetIndex`). On failure the caller
   * re-applies the pre-click snapshot instead.
   */
  next: VersionHistoryStackState;
}

/**
 * Computes the stack transition for one restore interaction.
 *
 * @param state Stacks + current index at click time; the caller keeps this
 *   as the rollback snapshot for when the server rejects the restore.
 * @param versionUrls Newest-first version URLs, mirroring the order of
 *   `getInpaintVersions` / the component's `versions` array.
 * @param intent What the user clicked: undo, redo, or a direct pill pick.
 * @param currentUrl The active result URL at click time, if any.
 * @returns The optimistic plan, or null when the intent is a no-op: an
 *   empty source stack, a target URL missing from the version list, or a
 *   direct pick of the version that is already current. null means
 *   "touch nothing" — callers must not mutate any state for it.
 */
export function planVersionRestore(
  state: VersionHistoryStackState,
  versionUrls: readonly string[],
  intent: VersionRestoreIntent,
  currentUrl: string | null
): VersionRestorePlan | null {
  switch (intent.kind) {
    case "undo": {
      if (state.undoStack.length === 0) return null;
      const targetUrl = state.undoStack[state.undoStack.length - 1];
      const targetIndex = versionUrls.indexOf(targetUrl);
      if (targetIndex < 0) return null;
      return {
        targetUrl,
        targetIndex,
        next: {
          undoStack: state.undoStack.slice(0, -1),
          // Redo history must survive an undo (#699): push, never clear.
          redoStack: currentUrl
            ? [...state.redoStack, currentUrl]
            : [...state.redoStack],
          currentIndex: targetIndex,
        },
      };
    }
    case "redo": {
      if (state.redoStack.length === 0) return null;
      const targetUrl = state.redoStack[state.redoStack.length - 1];
      const targetIndex = versionUrls.indexOf(targetUrl);
      if (targetIndex < 0) return null;
      return {
        targetUrl,
        targetIndex,
        next: {
          // Undo history must survive a redo (#699): push once, never clear.
          undoStack: currentUrl
            ? [...state.undoStack, currentUrl]
            : [...state.undoStack],
          redoStack: state.redoStack.slice(0, -1),
          currentIndex: targetIndex,
        },
      };
    }
    case "direct": {
      if (intent.targetIndex < 0 || intent.targetIndex >= versionUrls.length) {
        return null;
      }
      const targetUrl = versionUrls[intent.targetIndex];
      if (targetUrl === currentUrl) return null;
      return {
        targetUrl,
        targetIndex: intent.targetIndex,
        next: {
          undoStack: currentUrl
            ? [...state.undoStack, currentUrl]
            : [...state.undoStack],
          // Only a new pick outside undo/redo invalidates redo history.
          redoStack: [],
          currentIndex: intent.targetIndex,
        },
      };
    }
  }
}
