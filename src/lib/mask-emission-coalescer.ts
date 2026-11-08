/**
 * Issue #1427 — coalesce mask-buffer emission to at most one encode per
 * animation frame.
 *
 * `HTMLCanvasElement.toDataURL("image/png")` is a synchronous, full-canvas
 * read plus a PNG encode (≈1.5–3 MB base64 string on a 1024×1024 retina
 * canvas). When it ran on every `pointermove`, the cost of emitting the
 * mask scaled with *pointer sampling rate* (commonly 60–120+ per second)
 * instead of with the number of frames the user actually painted in,
 * stalling the paint loop for seconds-long jank on large canvases.
 *
 * This is the pure scheduling policy behind that fix, extracted so it can be
 * unit-tested without a DOM. The React component owns the canvas and the
 * `onChange` callback; this module owns the rules:
 *
 *  - a mid-stroke change is **coalesced**: the buffer is marked dirty and a
 *    single animation frame is requested. Any further changes that land
 *    before that frame runs are *trailing duplicates* and are dropped —
 *    they cost a boolean write, nothing more;
 *  - a frame runs **at most one encode**, carrying the buffer as of that
 *    frame — never one encode per pointer event;
 *  - a terminal event (pointerup / pointercancel / lost pointer capture)
 *    **flushes** immediately, so the parent holds the complete final mask
 *    the moment the stroke ends. This is issue #1344's guarantee and it is
 *    unchanged by the coalescing;
 *  - a **clear** (resetKey bump) discards any pending change, because the
 *    correct post-clear state is `null`, not a stale PNG.
 *
 * The frame scheduler is injected so this module stays free of DOM types
 * (it runs in the `node` test environment like the rest of `src/lib`).
 */

/**
 * The subset of the browser's frame API the policy needs. `request` must
 * schedule `callback` for the next frame and return a handle; `cancel`
 * must drop a scheduled callback by handle.
 */
export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/** The mutable state a coalescer tracks. */
export interface CoalescerState {
  /** A change is buffered and has not been serialized yet. */
  dirty: boolean;
  /** Handle of the frame scheduled to serialize the buffer, if any. */
  handle: number | null;
  /**
   * Incremented on every terminal flush. A frame callback captured an
   * older generation is stale (its change was already serialized by the
   * flush) and must not encode again.
   */
  generation: number;
}

export function createCoalescerState(): CoalescerState {
  return { dirty: false, handle: null, generation: 0 };
}

/**
 * Record a mid-stroke change and make sure a frame is scheduled to
 * serialize it.
 *
 * Cheap and synchronous: this is the call made from every `pointermove`,
 * so its cost must not scale with canvas size. When a frame is already
 * scheduled the call is a no-op beyond setting the dirty flag — the
 * trailing duplicate is dropped, and the scheduled frame will serialize
 * the newest buffer state.
 */
export function markDirty(
  state: CoalescerState,
  scheduler: FrameScheduler,
  serialize: () => void,
): void {
  state.dirty = true;
  // A frame is already pending: drop this trailing duplicate.
  if (state.handle !== null) return;

  const generation = state.generation;
  state.handle = scheduler.request(() => {
    state.handle = null;
    // Stale frame: a terminal flush already serialized this change.
    if (generation !== state.generation) return;
    if (!state.dirty) return;
    state.dirty = false;
    serialize();
  });
}

/**
 * Serialize the buffer now and cancel any scheduled frame.
 *
 * Called from the terminal handlers of a stroke (pointerup, pointercancel,
 * lost pointer capture) and from the unmount path. Returns `true` when an
 * encode was actually performed, `false` when the buffer was clean and the
 * expensive work was correctly skipped.
 *
 * This is the issue #1344 guarantee: after a stroke ends, the parent holds
 * the complete final mask — not a frame-batched approximation of it.
 */
export function flush(
  state: CoalescerState,
  scheduler: FrameScheduler,
  serialize: () => void,
): boolean {
  // Invalidate the scheduled frame so it cannot encode a second time.
  state.generation += 1;
  if (state.handle !== null) {
    scheduler.cancel(state.handle);
    state.handle = null;
  }
  if (!state.dirty) return false;
  state.dirty = false;
  serialize();
  return true;
}

/**
 * Drop a pending change without serializing it.
 *
 * Used when the buffer is cleared (`resetKey` bump / canvas resize): the
 * parent is told the mask is empty (`null`), so a frame that fires
 * afterwards must not resurrect a stale PNG of the old strokes.
 */
export function discardPending(
  state: CoalescerState,
  scheduler: FrameScheduler,
): void {
  state.generation += 1;
  if (state.handle !== null) {
    scheduler.cancel(state.handle);
    state.handle = null;
  }
  state.dirty = false;
}

/**
 * Whether a pending change still needs emitting — used by the unmount path
 * and by tests asserting nothing was silently dropped.
 */
export function hasPendingChange(state: CoalescerState): boolean {
  return state.dirty;
}
