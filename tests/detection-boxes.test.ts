/**
 * Issue #1468 — the pure detection-box mapper.
 *
 * `src/lib/detection-boxes.ts` turns the provider's binary instance
 * masks into the percent-space bounding boxes the Edit Room studio
 * renders (it used to render two hard-coded placeholder boxes instead —
 * `obj-1` at 49/57/31/42 and `obj-2` at 8/58/23/27).
 *
 * Pinned cases:
 *  - A painted rectangle yields the EXACT percent box (the cell
 *    fractions × 100).
 *  - An empty grid yields NO detection.
 *  - Several masks produce one detection each, with ids
 *    `${concept}:${index}` and the labels "concept", "concept 2", ….
 *  - Malformed dimensions (zero / negative / non-finite / a grid
 *    shorter than width × height) SKIP the instance instead of throwing.
 *  - A mask that failed to decode (`null`) is skipped WITHOUT shifting
 *    the other instances' ids.
 */

import { describe, expect, it } from "vitest";

import {
  buildDetectedObjects,
  decodeMaskDataUrls,
  percentBoundingBox,
  type DecodedInstance,
} from "@/lib/detection-boxes";

/** Builds a grid of `width`×`height` cells with the given cells painted. */
function grid(
  width: number,
  height: number,
  painted: ReadonlyArray<readonly [number, number]> = []
): Uint8Array {
  const cells = new Uint8Array(width * height);
  for (const [x, y] of painted) {
    cells[y * width + x] = 1;
  }
  return cells;
}

describe("percentBoundingBox (issue #1468)", () => {
  it("maps a painted rectangle to its exact percent box", () => {
    // A 10×10 grid with a 2×2 block painted at x = 2..3, y = 4..5.
    const instance: DecodedInstance = {
      grid: grid(10, 10, [
        [2, 4],
        [3, 4],
        [2, 5],
        [3, 5],
      ]),
      width: 10,
      height: 10,
    };

    expect(percentBoundingBox(instance)).toEqual({
      x: 20,
      y: 40,
      w: 20,
      h: 20,
    });
  });

  it("keeps the fractional percent of a non-square grid", () => {
    // 4×2 grid, one painted cell at (1, 0) → x = 25%, y = 0%, 25% × 50%.
    const instance: DecodedInstance = {
      grid: grid(4, 2, [[1, 0]]),
      width: 4,
      height: 2,
    };

    const box = percentBoundingBox(instance);
    expect(box).not.toBeNull();
    expect(box?.x).toBeCloseTo(25, 10);
    expect(box?.y).toBeCloseTo(0, 10);
    expect(box?.w).toBeCloseTo(25, 10);
    expect(box?.h).toBeCloseTo(50, 10);
  });

  it("returns null for an empty grid (nothing painted)", () => {
    expect(
      percentBoundingBox({ grid: grid(8, 8), width: 8, height: 8 })
    ).toBeNull();
  });

  it("returns null (never throws) for malformed dimensions", () => {
    const painted = grid(4, 4, [[0, 0]]);
    expect(percentBoundingBox({ grid: painted, width: 0, height: 4 })).toBeNull();
    expect(percentBoundingBox({ grid: painted, width: 4, height: -2 })).toBeNull();
    expect(
      percentBoundingBox({ grid: painted, width: Number.NaN, height: 4 })
    ).toBeNull();
    // A grid shorter than width × height is malformed too.
    expect(percentBoundingBox({ grid: grid(2, 2), width: 4, height: 4 })).toBeNull();
    expect(percentBoundingBox(null)).toBeNull();
    expect(percentBoundingBox(undefined)).toBeNull();
  });
});

describe("buildDetectedObjects (issue #1468)", () => {
  it("yields no detection for an empty grid", () => {
    const detections = buildDetectedObjects("sofa", [
      { grid: grid(10, 10), width: 10, height: 10 },
    ]);
    expect(detections).toEqual([]);
  });

  it("gives every mask an id and a label per the studio's convention", () => {
    const detections = buildDetectedObjects("sofa", [
      { grid: grid(10, 10, [[0, 0]]), width: 10, height: 10 },
      { grid: grid(10, 10, [[5, 5]]), width: 10, height: 10 },
      { grid: grid(10, 10, [[9, 9]]), width: 10, height: 10 },
    ]);

    expect(detections.map((d) => d.id)).toEqual([
      "sofa:0",
      "sofa:1",
      "sofa:2",
    ]);
    expect(detections.map((d) => d.label)).toEqual([
      "sofa",
      "sofa 2",
      "sofa 3",
    ]);
    expect(detections.every((d) => d.concept === "sofa")).toBe(true);
    // The boxes come from the masks, not from hard-coded literals.
    expect(detections[0].box).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(detections[1].box).toEqual({ x: 50, y: 50, w: 10, h: 10 });
  });

  it("skips a malformed instance without shifting the other ids", () => {
    const detections = buildDetectedObjects("chair", [
      // Malformed: zero width.
      { grid: grid(4, 4, [[0, 0]]), width: 0, height: 4 },
      // Malformed: grid shorter than width × height.
      { grid: grid(2, 2), width: 4, height: 4 },
      // A mask that failed to decode client-side.
      null,
      // The one usable instance.
      { grid: grid(10, 10, [[1, 1]]), width: 10, height: 10 },
    ]);

    expect(detections).toHaveLength(1);
    expect(detections[0].id).toBe("chair:3");
    expect(detections[0].label).toBe("chair 4");
    expect(detections[0].box).toEqual({ x: 10, y: 10, w: 10, h: 10 });
  });

  it("returns an empty list when there are no instances at all", () => {
    expect(buildDetectedObjects("furniture", [])).toEqual([]);
  });
});

describe("decodeMaskDataUrls (issue #1468)", () => {
  it("keeps one slot per mask so the ids keep matching the response", async () => {
    // No DOM in the unit-test environment → every mask decodes to null,
    // but the result stays index-aligned with the response.
    const decoded = await decodeMaskDataUrls([
      "data:image/png;base64,AAAA",
      "data:image/png;base64,BBBB",
    ]);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toBeNull();
    expect(decoded[1]).toBeNull();
  });

  it("rejects a non-image payload", async () => {
    const decoded = await decodeMaskDataUrls(["not-a-data-url"]);
    expect(decoded).toEqual([null]);
  });
});
