/**
 * Issue #1427 — `MaskLayer` ran a full-canvas `toDataURL` on every
 * `pointermove`, so mask emission cost scaled with pointer sampling rate
 * rather than with the number of strokes drawn.
 *
 * These tests pin the coalescing policy that replaced it, and — just as
 * importantly — pin that the fix does **not** weaken issue #1344, which
 * requires the parent to always hold the current mask buffer after a
 * stroke.
 */
import { describe, it, expect } from "vitest";
import {
  beginStroke,
  createCoalescerState,
  flush,
  hasPendingChange,
  markDirty,
} from "@/lib/mask-emission-coalescer";

/** Drives the policy exactly as the component does, counting real encodes. */
function harness() {
  const state = createCoalescerState();
  let encodes = 0;
  let lastValue: string | null = null;
  return {
    state,
    get encodes() {
      return encodes;
    },
    get lastValue() {
      return lastValue;
    },
    /** `pointermove` — must be cheap. */
    move(value: string) {
      markDirty(state);
      lastValue = value;
    },
    /** `pointerdown` / stroke start. */
    begin() {
      if (beginStroke(state) === "flush") {
        encodes += 1;
      }
    },
    /** `pointerup` — the terminal event. */
    end() {
      if (flush(state)) {
        encodes += 1;
        return lastValue;
      }
      return null;
    },
    /** Unmount path. */
    unmount() {
      if (flush(state)) encodes += 1;
    },
  };
}

describe("mask emission coalescer (#1427)", () => {
  it("does not serialize on mid-stroke moves", () => {
    const h = harness();
    h.begin();
    h.move("a");
    h.move("b");
    h.move("c");

    expect(h.encodes).toBe(0);
    expect(hasPendingChange(h.state)).toBe(true);
  });

  it("serializes exactly once for a stroke of any length", () => {
    const h = harness();
    h.begin();
    // 200 pointermove samples, the pathological case from the issue.
    for (let i = 0; i < 200; i += 1) h.move(`p${i}`);
    expect(h.encodes).toBe(0);

    const emitted = h.end();
    expect(emitted).toBe("p199");
    expect(h.encodes).toBe(1);
  });

  it("emission count scales with strokes, not with pointer samples", () => {
    const h = harness();
    // 20 strokes x 25 samples each.
    for (let s = 0; s < 20; s += 1) {
      h.begin();
      for (let i = 0; i < 25; i += 1) h.move(`${s}-${i}`);
      h.end();
    }
    // Before the fix this would have been 500 encodes.
    expect(h.encodes).toBe(20);
  });

  it("skips the encode for a terminal event that changed nothing", () => {
    const h = harness();
    h.begin();
    expect(h.end()).toBeNull();
    expect(h.encodes).toBe(0);
  });

  it("carries the final buffer to the parent (#1344)", () => {
    const h = harness();
    h.begin();
    h.move("stroke-1");
    h.end();
    expect(h.lastValue).toBe("stroke-1");

    // An erase-only stroke must still deliver the reduced buffer.
    h.begin();
    h.move("stroke-2-after-erase");
    expect(h.end()).toBe("stroke-2-after-erase");
  });

  it("emits a cancelled stroke's change on the next stroke", () => {
    const h = harness();
    h.begin();
    h.move("cancelled-stroke");
    // No terminal event: the pointer was cancelled / capture lost.
    expect(h.encodes).toBe(0);
    expect(hasPendingChange(h.state)).toBe(true);

    // The next stroke must drain the stranded change rather than lose it.
    h.begin();
    expect(h.encodes).toBe(1);
    expect(h.lastValue).toBe("cancelled-stroke");
  });

  it("flushes a pending change on unmount", () => {
    const h = harness();
    h.begin();
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

  it("does not double-flush when a cancelled stroke is drained", () => {
    const h = harness();
    h.begin();
    h.move("first");
    h.begin(); // drains the stranded "first"
    expect(h.encodes).toBe(1);

    h.move("second");
    h.end(); // terminal event for the second stroke
    expect(h.encodes).toBe(2);
    expect(h.lastValue).toBe("second");
  });
});