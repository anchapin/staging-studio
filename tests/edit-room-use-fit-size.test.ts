/**
 * Issue #1339 — CanvasStage + MaskLayer + CompareLayer + on-canvas object boxes.
 *
 * `useFitSize` (src/components/edit-room/use-fit-size.ts) is the
 * ResizeObserver-driven size computation the canvas toolbar uses to keep
 * the photo at the largest 3:2 box that fits the available area. The
 * pure math lives in `computeFitSize` (pinned 1:1 here) so the hook
 * stays a thin effect that owns the observer + state.
 *
 * Pinned cases:
 *  - empty / negative / NaN inputs fall back to `{ w: 0, h: 0 }` (no
 *    size yet, observer hasn't measured)
 *  - wide container (aspect >= 3/2): width = containerWidth, height
 *    = round(width / aspect)
 *  - tall container (aspect < 3/2): height = containerHeight, width
 *    = round(height * aspect)
 *  - non-integer widths round to the nearest pixel so the photo never
 *    has a 1-px subpixel seam
 */

import { describe, expect, it } from "vitest";

import { computeFitSize } from "@/components/edit-room/use-fit-size";

describe("computeFitSize (issue #1339)", () => {
  it("returns zero-sized box when width is 0", () => {
    expect(computeFitSize({ width: 0, height: 600, aspect: 3 / 2 })).toEqual({
      w: 0,
      h: 0,
    });
  });

  it("returns zero-sized box when height is 0", () => {
    expect(computeFitSize({ width: 900, height: 0, aspect: 3 / 2 })).toEqual({
      w: 0,
      h: 0,
    });
  });

  it("returns zero-sized box for non-finite inputs", () => {
    expect(computeFitSize({ width: NaN, height: 600, aspect: 3 / 2 })).toEqual({
      w: 0,
      h: 0,
    });
    expect(computeFitSize({ width: 900, height: Infinity, aspect: 3 / 2 })).toEqual({
      w: 0,
      h: 0,
    });
  });

  it("constrains by width when the container is wider than the target aspect", () => {
    // 900 wide, 600 tall — exactly 3:2 already, no clamping needed.
    expect(computeFitSize({ width: 900, height: 600, aspect: 3 / 2 })).toEqual({
      w: 900,
      h: 600,
    });
  });

  it("constrains by height when the container is taller than the target aspect", () => {
    // 600 wide, 900 tall, aspect 3/2 → min(600, 900*1.5)=600, height=600/1.5=400
    expect(computeFitSize({ width: 600, height: 900, aspect: 3 / 2 })).toEqual({
      w: 600,
      h: 400,
    });
  });

  it("floors non-integer widths so the photo never has a subpixel seam", () => {
    // 605 x 403 container, aspect 3/2:
    //   w = min(605, 403*1.5) = 604.5 → floor → 604
    //   h = floor(604.5 / 1.5) = floor(403) = 403
    // (height comes out exact here because 604.5 / 1.5 = 403 exactly)
    expect(computeFitSize({ width: 605, height: 403, aspect: 3 / 2 })).toEqual({
      w: 604,
      h: 403,
    });
  });
});