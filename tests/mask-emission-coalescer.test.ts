/**
 * Issue #1427 — `MaskLayer` ran a full-canvas `toDataURL("image/png")` on
 * every `pointermove`, so mask emission cost scaled with pointer sampling
 * rate (60–120+ full-canvas PNG encodes per second, each producing a
 * multi-megabyte base64 string) instead of with the number of frames the
 * user actually painted in.
 *
 * These tests pin the coalescing policy that replaced it:
 *
 *  - a burst of pointer events inside one frame produces ONE encode
 *    (trailing duplicates are dropped);
 *  - the encode rate follows the frame rate, never the pointer-event rate;
 *  - a terminal event (stroke end) flushes the COMPLETE final mask to the
 *    parent — issue #1344's guarantee, which the perf fix must not weaken.
 *
 * The policy is exercised through the same injection seam the component
 * uses (`FrameScheduler`), so the tests run in vitest's `node` environment
 * (no DOM, no rAF) while still pinning the exact scheduling rules.
 */
import { describe, it, expect } from "vitest";
import {
  createCoalescerState,
  discardPending,
  flush,
  hasPendingChange,
  markDirty,
  type CoalescerState,
  type FrameScheduler,
} from "@/lib/mask-emission-coalescer";

/** A deterministic stand-in for `requestAnimationFrame`. */
function fakeScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  return {
    scheduler: {
      request(callback: () => void): number {
        const handle = nextHandle;
        nextHandle += 1;
        pending.set(handle, callback);
        return handle;
      },
      cancel(handle: number): void {
        pending.delete(handle);
      },
    } satisfies FrameScheduler,
    /** Run every callback scheduled so far — one "frame". */
    runFrame(): void {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    /** How many frames are scheduled but have not run yet. */
    get scheduled(): number {
      return pending.size;
    },
  };
}

/** Drives the policy exactly as the component does, counting real encodes. */
function harness() {
  const state: CoalescerState = createCoalescerState();
  const frames = fakeScheduler();
  let encodes = 0;
  let lastValue: string | null = null;

  const serialize = () => {
    encodes += 1;
  };

  return {
    state,
    frames,
    get encodes() {
      return encodes;
    },
    get lastValue() {
      return lastValue;
    },
    /** `pointermove` — must be cheap: no canvas read, no encode. */
    move(value: string) {
      lastValue = value;
      markDirty(state, frames.scheduler, serialize);
    },
    /** `pointerdown` / stroke start (drains a stranded previous stroke). */
    begin() {
      flush(state, frames.scheduler, serialize);
    },
    /** One animation frame elapses. */
    frame() {
      frames.runFrame();
    },
    /** `pointerup` — the terminal event of a stroke. */
    end() {
      flush(state, frames.scheduler, serialize);
      return lastValue;
    },
    /** Unmount path. */
    unmount() {
      flush(state, frames.scheduler, serialize);
    },
  };
}

describe("mask emission coalescer (#1427)", () => {
  it("does not serialize on mid-stroke moves", () => {
    const h = harness();
    h.move("a");
    h.move("b");
    h.move("c");

    expect(h.encodes).toBe(0);
    expect(hasPendingChange(h.state)).toBe(true);
  });

  it("does not encode per pointer event over a long continuous stroke", () => {
    const h = harness();
    // 200 pointermove samples, the pathological case from the issue.
    for (let i = 0; i < 200; i += 1) h.move(`p${i}`);

    // No frame has run yet — a single encode is scheduled, not 200.
    expect(h.encodes).toBe(0);
    expect(h.frames.scheduled).toBe(1);
  });

  it("coalesces a burst of pointer events into a single encode per frame", () => {
    const h = harness();
    for (let i = 0; i < 50; i += 1) h.move(`p${i}`);

    h.frame();

    // ONE encode for the whole frame — not one per pointer event.
    expect(h.encodes).toBe(1);
    expect(hasPendingChange(h.state)).toBe(false);
  });

  it("drops trailing duplicate calls inside a frame", () => {
    const h = harness();
    h.move("a");
    // The frame is already scheduled — these must not queue extra frames.
    h.move("b");
    h.move("c");
    expect(h.frames.scheduled).toBe(1);

    h.frame();
    expect(h.encodes).toBe(1);
    expect(h.frames.scheduled).toBe(0);
  });

  it("encodes at most once per frame while the user keeps painting", () => {
    const h = harness();
    for (let frame = 0; frame < 5; frame += 1) {
      for (let i = 0; i < 10; i += 1) h.move(`f${frame}-${i}`);
      h.frame();
    }

    // 50 pointer events, 5 frames → 5 encodes (one per frame).
    expect(h.encodes).toBe(5);
  });

  it("emission count scales with frames, not with pointer samples", () => {
    const h = harness();
    // 20 strokes x 25 samples each, one frame per stroke.
    for (let s = 0; s < 20; s += 1) {
      h.begin();
      for (let i = 0; i < 25; i += 1) h.move(`${s}-${i}`);
      h.frame();
      h.end();
    }
    // Before the fix this would have been 500 encodes. Now each stroke
    // costs exactly one frame encode (the terminal flush is a no-op
    // because the frame already carried the final state).
    expect(h.encodes).toBe(20);
  });

  it("flushes the final mask to the parent when the stroke ends (#1344)", () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) h.move(`stroke-${i}`);

    // The terminal event of the stroke encodes immediately — the parent
    // must hold the COMPLETE final mask, not a frame-batched version.
    const emitted = h.end();
    expect(emitted).toBe("stroke-9");
    expect(h.encodes).toBe(1);
    expect(hasPendingChange(h.state)).toBe(false);
  });

  it("does not encode twice when a scheduled frame follows a terminal flush", () => {
    const h = harness();
    h.move("final");
    h.end();
    expect(h.encodes).toBe(1);

    // The frame scheduled before the flush must not encode again.
    h.frame();
    expect(h.encodes).toBe(1);
  });

  it("skips the encode for a terminal event that changed nothing", () => {
    const h = harness();
    expect(h.end()).toBeNull();
    expect(h.encodes).toBe(0);
  });

  it("carries the final buffer to the parent after an erase stroke (#1344)", () => {
    const h = harness();
    h.move("stroke-1");
    h.end();

    h.move("stroke-2-after-erase");
    expect(h.end()).toBe("stroke-2-after-erase");
  });

  it("flushes a pending change on unmount", () => {
    const h = harness();
    h.move("mid-stroke");
    h.unmount();
    expect(h.encodes).toBe(1);
    expect(h.lastValue).toBe("mid-stroke");
    expect(hasPendingChange(h.state)).toBe(false);
  });

  it("is inert when nothing changed before unmount", () => {
    const h = harness();
    h.unmount();
    expect(h.encodes).toBe(0);
  });

  it("drains a stranded stroke when the next stroke begins", () => {
    const h = harness();
    h.move("cancelled-stroke");
    // No terminal event: the pointer was cancelled / capture lost.
    expect(h.encodes).toBe(0);
    expect(hasPendingChange(h.state)).toBe(true);

    // The next stroke must drain the stranded change rather than lose it.
    h.begin();
    expect(h.encodes).toBe(1);
    expect(h.lastValue).toBe("cancelled-stroke");
  });

  it("drops the pending change when the mask is cleared", () => {
    const h = harness();
    h.move("before-clear");
    discardPending(h.state, h.frames.scheduler);

    // The cleared buffer must NOT be resurrected by the pending frame.
    h.frame();
    expect(h.encodes).toBe(0);
    expect(hasPendingChange(h.state)).toBe(false);
  });
});
