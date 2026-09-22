import { describe, expect, it } from "vitest";

/**
 * Issue #618: Split before/after comparison canvas
 *
 * Pins the pure logic in lib/split-comparison-canvas.ts 1:1 — split
 * clamping/pointer math, before-layer counter-scaling, version pill
 * labels, and the undo/redo/reset history reducer — same pattern as
 * tests/workbench-layout.test.ts.
 */
import {
  EMPTY_SPLIT_HISTORY,
  INITIAL_SPLIT_PERCENT,
  MAX_VISIBLE_VERSION_PILLS,
  activeVersionId,
  beforeLayerInnerWidthPercent,
  canRedoSplitHistory,
  canUndoSplitHistory,
  clampSplitPercent,
  nextSplitHistory,
  rangeAriaLabel,
  splitPercentFromClientX,
  versionPillLabel,
  visibleVersionPills,
} from "@/lib/split-comparison-canvas";

describe("clampSplitPercent — issue #618", () => {
  it("starts at the spec'd 42%", () => {
    expect(INITIAL_SPLIT_PERCENT).toBe(42);
  });

  it("passes through in-range values", () => {
    expect(clampSplitPercent(0)).toBe(0);
    expect(clampSplitPercent(42)).toBe(42);
    expect(clampSplitPercent(100)).toBe(100);
    expect(clampSplitPercent(73.25)).toBe(73.25);
  });

  it("clamps out-of-range values to 0 and 100", () => {
    expect(clampSplitPercent(-5)).toBe(0);
    expect(clampSplitPercent(120)).toBe(100);
    expect(clampSplitPercent(Infinity)).toBe(100);
    expect(clampSplitPercent(-Infinity)).toBe(0);
  });

  it("falls back to 42% for non-finite input", () => {
    expect(clampSplitPercent(NaN)).toBe(INITIAL_SPLIT_PERCENT);
  });
});

describe("splitPercentFromClientX — issue #618", () => {
  const rect = { left: 100, width: 400 };

  it("maps the left edge to 0 and the right edge to 100", () => {
    expect(splitPercentFromClientX(100, rect)).toBe(0);
    expect(splitPercentFromClientX(500, rect)).toBe(100);
  });

  it("maps the horizontal midpoint to 50%", () => {
    expect(splitPercentFromClientX(300, rect)).toBe(50);
  });

  it("computes fractional positions", () => {
    // 42% of 400px = 168px past the left edge
    expect(splitPercentFromClientX(268, rect)).toBeCloseTo(42, 5);
  });

  it("clamps pointers outside the rect to the nearest edge", () => {
    expect(splitPercentFromClientX(40, rect)).toBe(0);
    expect(splitPercentFromClientX(900, rect)).toBe(100);
  });

  it("falls back to 42% for a degenerate/unmeasured rect", () => {
    expect(splitPercentFromClientX(300, { left: 0, width: 0 })).toBe(
      INITIAL_SPLIT_PERCENT
    );
    expect(splitPercentFromClientX(NaN, rect)).toBe(INITIAL_SPLIT_PERCENT);
  });
});

describe("beforeLayerInnerWidthPercent — issue #618", () => {
  it("counter-scales the inner holder so Before stays aligned with After", () => {
    // holder = 10000 / split: 50% split → holder is 200% of the clip layer
    expect(beforeLayerInnerWidthPercent(50)).toBe(200);
    expect(beforeLayerInnerWidthPercent(25)).toBe(400);
    expect(beforeLayerInnerWidthPercent(100)).toBe(100);
  });

  it("counter-scales the spec'd 42% start", () => {
    expect(beforeLayerInnerWidthPercent(42)).toBeCloseTo(10000 / 42, 5);
  });

  it("guards the divide-by-zero at a fully-closed split", () => {
    expect(Number.isFinite(beforeLayerInnerWidthPercent(0))).toBe(true);
    expect(beforeLayerInnerWidthPercent(0)).toBe(100);
  });
});

describe("version pill labels — issue #618", () => {
  it("labels 0-based indices as v1-style passes", () => {
    expect(versionPillLabel(0)).toBe("v1");
    expect(versionPillLabel(2)).toBe("v3");
  });

  it("shows at most 3 pills by default (v1/v2/v3 spec)", () => {
    expect(MAX_VISIBLE_VERSION_PILLS).toBe(3);
  });

  it("returns all versions when under the cap", () => {
    const pills = visibleVersionPills(["a", "b", "c"]);
    expect(pills.map((p) => p.label)).toEqual(["v1", "v2", "v3"]);
    expect(pills.map((p) => p.item)).toEqual(["a", "b", "c"]);
    expect(pills.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it("keeps the most recent passes when over the cap", () => {
    const pills = visibleVersionPills(["a", "b", "c", "d", "e"]);
    expect(pills.map((p) => p.label)).toEqual(["v3", "v4", "v5"]);
    expect(pills.map((p) => p.index)).toEqual([2, 3, 4]);
  });

  it("returns nothing for an empty or non-positive cap", () => {
    expect(visibleVersionPills([])).toEqual([]);
    expect(visibleVersionPills(["a"], 0)).toEqual([]);
  });
});

describe("nextSplitHistory reducer — issue #618", () => {
  const state = { order: ["v1", "v2", "v3"], cursor: 2 };

  it("select jumps the cursor to a known version", () => {
    const next = nextSplitHistory(state, { type: "select", id: "v1" });
    expect(next).toEqual({ order: ["v1", "v2", "v3"], cursor: 0 });
  });

  it("select with an unknown id is a no-op", () => {
    expect(nextSplitHistory(state, { type: "select", id: "nope" })).toBe(state);
  });

  it("undo steps back one pass and never below the first", () => {
    const once = nextSplitHistory(state, { type: "undo" });
    expect(once.cursor).toBe(1);
    const twice = nextSplitHistory(once, { type: "undo" });
    expect(twice.cursor).toBe(0);
    const floor = nextSplitHistory(twice, { type: "undo" });
    expect(floor).toBe(twice);
  });

  it("redo steps forward one pass and never past the latest", () => {
    const back = nextSplitHistory(state, { type: "undo" });
    const forward = nextSplitHistory(back, { type: "redo" });
    expect(forward.cursor).toBe(2);
    const ceil = nextSplitHistory(forward, { type: "redo" });
    expect(ceil).toBe(forward);
  });

  it("reset snaps straight back to the latest pass", () => {
    const back = nextSplitHistory(
      nextSplitHistory(state, { type: "undo" }),
      { type: "undo" }
    );
    expect(back.cursor).toBe(0);
    const reset = nextSplitHistory(back, { type: "reset" });
    expect(reset.cursor).toBe(2);
    // reset while already latest is a no-op
    expect(nextSplitHistory(reset, { type: "reset" })).toBe(reset);
  });

  it("empty history is inert", () => {
    expect(nextSplitHistory(EMPTY_SPLIT_HISTORY, { type: "undo" })).toBe(
      EMPTY_SPLIT_HISTORY
    );
  });

  it("canUndo/canRedo/activeVersionId flags track the cursor", () => {
    expect(canUndoSplitHistory(state)).toBe(true);
    expect(canRedoSplitHistory(state)).toBe(false);
    expect(activeVersionId(state)).toBe("v3");

    const first = { order: ["v1", "v2", "v3"] as const, cursor: 0 };
    expect(canUndoSplitHistory(first)).toBe(false);
    expect(canRedoSplitHistory(first)).toBe(true);
    expect(activeVersionId(first)).toBe("v1");

    expect(activeVersionId(EMPTY_SPLIT_HISTORY)).toBeNull();
    expect(canUndoSplitHistory(EMPTY_SPLIT_HISTORY)).toBe(false);
    expect(canRedoSplitHistory(EMPTY_SPLIT_HISTORY)).toBe(false);
  });
});

describe("rangeAriaLabel — issue #618", () => {
  it("names the invisible range input accessibly", () => {
    expect(rangeAriaLabel("Before", "After")).toBe(
      "Before / After comparison divider position"
    );
  });
});
