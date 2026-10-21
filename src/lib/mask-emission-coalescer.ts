/**
 * Issue #1427 — coalesce mask-buffer emission to once per stroke.
 *
 * `HTMLCanvasElement.toDataURL("image/png")` is a synchronous, full-canvas
 * read plus a PNG encode. When it ran on every `pointermove`, the cost of
 * emitting the mask scaled with *pointer sampling rate* (commonly 60–120+
 * per second) instead of with the number of strokes the user actually drew,
 * stalling the paint loop on large canvases.
 *
 * This is the pure scheduling policy behind that fix, extracted so it can be
 * unit-tested without a DOM. The React component owns the refs; this module
 * owns the rules:
 *
 *  - a mid-stroke change is **coalesced** (buffered, no encode);
 *  - a terminal event **flushes** exactly one encode carrying the final
 *    state, preserving issue #1344's guarantee that the parent always ends
 *    up holding the current buffer;
 *  - a stroke that never reaches a terminal event (pointer cancelled /
 *    pointer capture lost) is **not lost** — its buffered change is emitted
 *    before the next stroke begins.
 *
 * Kept deliberately free of React and DOM types so it runs in the `node`
 * test environment like the rest of `src/lib`.
 */

/** The mutable state a coalescer tracks. */
export interface CoalescerState {
  /** A change is buffered and has not been serialized yet. */
  dirty: boolean;
  /** A stroke began and has not reported a terminal event yet. */
  strokeActive: boolean;
}

export function createCoalescerState(): CoalescerState {
  return { dirty: false, strokeActive: false };
}

/**
 * What the caller must do after reporting the start of a stroke.
 *
 * `"flush"` means a stranded change from a cancelled stroke was pending and
 * has just been emitted, so the caller must serialize before continuing.
 */
export type BeginStrokeResult = "none" | "flush";

/**
 * Record a mid-stroke change without paying for the encode.
 *
 * Cheap and synchronous: this is the call made from every `pointermove`, so
 * its cost must not scale with canvas size.
 */
export function markDirty(state: CoalescerState): void {
  state.dirty = true;
}

/** Report the end of a stroke (called from `pointerdown`). */
export function beginStroke(state: CoalescerState): BeginStrokeResult {
  // A previous stroke that ended without a terminal event (cancelled /
  // capture lost) left its change buffered with nothing to drain it. Emit
  // it now, before this stroke takes ownership, so a cancelled stroke can
  // never lose its final state.
  if (state.strokeActive && state.dirty) {
    state.dirty = false;
    return "flush";
  }
  state.strokeActive = true;
  return "none";
}

/**
 * Serialize the buffer and clear the dirty flag.
 *
 * Returns `true` when an encode was actually performed, `false` when the
 * buffer was clean and the expensive work was correctly skipped. Terminal
 * handlers call this unconditionally — the check keeps a no-op terminal
 * event (e.g. a click that painted nothing) free.
 */
export function flush(state: CoalescerState): boolean {
  state.strokeActive = false;
  if (!state.dirty) return false;
  state.dirty = false;
  return true;
}

/**
 * Whether a pending change still needs emitting — used by the unmount path
 * and by tests asserting nothing was silently dropped.
 */
export function hasPendingChange(state: CoalescerState): boolean {
  return state.dirty;
}