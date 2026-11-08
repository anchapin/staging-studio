/**
 * Unit tests for edit-conservation-regions.ts (issue #1467).
 *
 * These pin the region measurement layer that the inpaint QA path depends
 * on: the grid partitioning, the strict per-pixel tolerance, the mask
 * exemption coverage rule and the "not measured" no-ops.
 *
 * The fixtures are plain RGBA byte buffers (no DOM, no canvas): the module
 * only ever reads `data[offset..offset+3]`.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MIN_MASK_COVERAGE,
  DEFAULT_REGION_GRID_COLUMNS,
  DEFAULT_REGION_GRID_ROWS,
  DEFAULT_REGION_PIXEL_TOLERANCE,
  buildSceneConservationMeasurements,
  computeMaskRegionIds,
  computeRegionChangeScores,
  isUsableFrame,
  regionId,
  type RgbaFrame,
} from "@/lib/edit-conservation-regions";

/** Builds an opaque black RGBA frame of the given size. */
function makeFrame(width: number, height: number): RgbaFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Writes one RGBA pixel into a frame. */
function setPixel(
  frame: RgbaFrame,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number
): void {
  const offset = (y * frame.width + x) * 4;
  frame.data[offset] = r;
  frame.data[offset + 1] = g;
  frame.data[offset + 2] = b;
  frame.data[offset + 3] = a;
}

/** Deep-copies a frame so the reference and the candidate can differ. */
function cloneFrame(frame: RgbaFrame): RgbaFrame {
  return {
    width: frame.width,
    height: frame.height,
    data: new Uint8ClampedArray(frame.data),
  };
}

/** The region ids of a scored list, in order. */
function ids(regions: { regionId: string }[]): string[] {
  return regions.map((region) => region.regionId);
}

describe("isUsableFrame", () => {
  it("accepts a frame whose buffer covers every pixel", () => {
    expect(isUsableFrame(makeFrame(4, 4))).toBe(true);
  });

  it("rejects a truncated / short buffer", () => {
    const frame = makeFrame(4, 4);
    const truncated: RgbaFrame = {
      width: frame.width,
      height: frame.height,
      data: frame.data.slice(0, frame.data.length - 4),
    };
    expect(isUsableFrame(truncated)).toBe(false);
  });

  it("rejects empty, zero-sized and missing frames", () => {
    expect(isUsableFrame(null)).toBe(false);
    expect(isUsableFrame(undefined)).toBe(false);
    expect(isUsableFrame({ width: 0, height: 4, data: new Uint8ClampedArray(0) })).toBe(
      false
    );
    expect(isUsableFrame({ width: 4, height: 0, data: new Uint8ClampedArray(0) })).toBe(
      false
    );
  });
});

describe("computeRegionChangeScores", () => {
  it("scores identical frames as 16 all-zero regions in row-major order", () => {
    const reference = makeFrame(4, 4);
    const candidate = cloneFrame(reference);

    const regions = computeRegionChangeScores(reference, candidate);

    expect(DEFAULT_REGION_GRID_ROWS).toBe(4);
    expect(DEFAULT_REGION_GRID_COLUMNS).toBe(4);
    expect(regions).toHaveLength(16);
    expect(ids(regions)).toEqual([
      "r0c0",
      "r0c1",
      "r0c2",
      "r0c3",
      "r1c0",
      "r1c1",
      "r1c2",
      "r1c3",
      "r2c0",
      "r2c1",
      "r2c2",
      "r2c3",
      "r3c0",
      "r3c1",
      "r3c2",
      "r3c3",
    ]);
    expect(regions.every((region) => region.changedFraction === 0)).toBe(true);
    // The mask is applied by computeMaskRegionIds, not here.
    expect(regions.every((region) => region.insideMask === false)).toBe(true);
    expect(regionId(3, 3)).toBe("r3c3");
  });

  it("scores only the cell that actually changed", () => {
    const reference = makeFrame(4, 4);
    const candidate = cloneFrame(reference);
    // 4x4 frame with the default 4x4 grid => every cell is one pixel.
    setPixel(candidate, 2, 2, 200, 0, 0, 255);

    const regions = computeRegionChangeScores(reference, candidate);

    const changed = regions.filter((region) => region.changedFraction > 0);
    expect(changed).toHaveLength(1);
    expect(changed[0].regionId).toBe("r2c2");
    expect(changed[0].changedFraction).toBe(1);
    expect(regions.find((region) => region.regionId === "r2c2")?.changedFraction).toBe(1);
    expect(regions.find((region) => region.regionId === "r2c1")?.changedFraction).toBe(0);
  });

  it("treats the pixel tolerance as strict: delta == tolerance is unchanged", () => {
    const reference = makeFrame(4, 4);
    const candidate = cloneFrame(reference);
    setPixel(candidate, 0, 0, DEFAULT_REGION_PIXEL_TOLERANCE, 0, 0, 255);

    const regions = computeRegionChangeScores(reference, candidate);

    expect(regions.find((region) => region.regionId === "r0c0")?.changedFraction).toBe(0);
    expect(regions.every((region) => region.changedFraction === 0)).toBe(true);
  });

  it("treats tolerance + 1 as a change", () => {
    const reference = makeFrame(4, 4);
    const candidate = cloneFrame(reference);
    setPixel(candidate, 0, 0, DEFAULT_REGION_PIXEL_TOLERANCE + 1, 0, 0, 255);

    const regions = computeRegionChangeScores(reference, candidate);

    expect(regions.find((region) => region.regionId === "r0c0")?.changedFraction).toBe(1);
    expect(regions.filter((region) => region.changedFraction > 0)).toHaveLength(1);
  });

  it("honours an explicit pixel tolerance", () => {
    const reference = makeFrame(4, 4);
    const candidate = cloneFrame(reference);
    setPixel(candidate, 3, 3, 10, 0, 0, 255);

    expect(
      computeRegionChangeScores(reference, candidate, { pixelTolerance: 10 }).find(
        (region) => region.regionId === "r3c3"
      )?.changedFraction
    ).toBe(0);
    expect(
      computeRegionChangeScores(reference, candidate, { pixelTolerance: 9 }).find(
        (region) => region.regionId === "r3c3"
      )?.changedFraction
    ).toBe(1);
  });

  it("returns [] when the frame dimensions differ", () => {
    const reference = makeFrame(4, 4);
    const candidate = makeFrame(4, 3);

    expect(computeRegionChangeScores(reference, candidate)).toEqual([]);
  });

  it("returns [] when a frame is unusable (short buffer)", () => {
    const reference = makeFrame(4, 4);
    const candidate: RgbaFrame = {
      width: 4,
      height: 4,
      data: reference.data.slice(0, 8),
    };

    expect(computeRegionChangeScores(reference, candidate)).toEqual([]);
  });

  it("pins the grid geometry of a frame that is smaller than the grid", () => {
    // height 3 with 4 grid rows: the row boundaries are computed as
    // [floor(row*h/rows), max(yStart+1, floor((row+1)*h/rows))), so the
    // clamp makes row 0 and row 1 BOTH cover the single pixel row y = 0.
    // Rows 2 and 3 cover y = 1 and y = 2 respectively. The overlapping
    // first two rows are the current (pinned) behaviour: a change on the
    // top pixel row is reported by two regions.
    const reference = makeFrame(4, 3);
    const candidate = cloneFrame(reference);
    setPixel(candidate, 2, 0, 255, 255, 255, 255);

    const regions = computeRegionChangeScores(reference, candidate);

    expect(ids(regions)).toHaveLength(16);
    const changedIds = regions
      .filter((region) => region.changedFraction > 0)
      .map((region) => region.regionId);
    expect(changedIds).toEqual(["r0c2", "r1c2"]);
    expect(regions.find((region) => region.regionId === "r2c2")?.changedFraction).toBe(0);
  });
});

describe("computeMaskRegionIds", () => {
  it("exempts a cell whose mask coverage is exactly the minimum", () => {
    // 4x4 mask with a 2x2 grid => every cell holds 4 pixels; 2 masked
    // pixels are exactly DEFAULT_MIN_MASK_COVERAGE (0.5) and the rule is
    // an inclusive `>=`.
    const mask = makeFrame(4, 4);
    setPixel(mask, 0, 0, 255, 255, 255, 255);
    setPixel(mask, 1, 0, 255, 255, 255, 255);

    const masked = computeMaskRegionIds(mask, { rows: 2, columns: 2 });

    expect(DEFAULT_MIN_MASK_COVERAGE).toBe(0.5);
    expect(masked).toEqual(["r0c0"]);
  });

  it("does not exempt a cell whose coverage is just below the minimum", () => {
    const mask = makeFrame(4, 4);
    setPixel(mask, 0, 0, 255, 255, 255, 255);

    const masked = computeMaskRegionIds(mask, { rows: 2, columns: 2 });

    expect(masked).toEqual([]);
  });

  it("honours an explicit minimum mask coverage", () => {
    const mask = makeFrame(4, 4);
    setPixel(mask, 0, 0, 255, 255, 255, 255);

    // 1 of 4 pixels = 0.25 coverage.
    expect(computeMaskRegionIds(mask, { rows: 2, columns: 2, minMaskCoverage: 0.25 })).toEqual(
      ["r0c0"]
    );
    expect(
      computeMaskRegionIds(mask, { rows: 2, columns: 2, minMaskCoverage: 0.3 })
    ).toEqual([]);
  });

  it("does not count pixels below the isMaskedPixel alpha/luminance thresholds", () => {
    const mask = makeFrame(4, 4);
    // White but semi-transparent: alpha 127 < MASK_PIXEL_THRESHOLD (128).
    setPixel(mask, 0, 0, 255, 255, 255, 127);
    // Fully opaque but dim: luminance 127 < MASK_PIXEL_THRESHOLD (128).
    setPixel(mask, 1, 0, 127, 127, 127, 255);

    const masked = computeMaskRegionIds(mask, { rows: 2, columns: 2 });

    expect(masked).toEqual([]);

    // Turning both pixels into properly painted ones reaches the 0.5
    // coverage of the cell and exempts it.
    setPixel(mask, 0, 0, 255, 255, 255, 255);
    setPixel(mask, 1, 0, 255, 255, 255, 255);
    expect(computeMaskRegionIds(mask, { rows: 2, columns: 2 })).toEqual(["r0c0"]);
  });

  it("returns [] for an unusable mask", () => {
    expect(computeMaskRegionIds({ width: 4, height: 4, data: new Uint8ClampedArray(8) })).toEqual(
      []
    );
    expect(computeMaskRegionIds({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toEqual(
      []
    );
  });
});

describe("buildSceneConservationMeasurements", () => {
  it("builds an all-zero before baseline by construction", () => {
    const reference = makeFrame(4, 4);
    const candidate = cloneFrame(reference);
    setPixel(candidate, 1, 1, 255, 0, 0, 255);

    const measurements = buildSceneConservationMeasurements({ reference, candidate });

    expect(measurements).not.toBeNull();
    expect(measurements?.before).toHaveLength(16);
    expect(measurements?.before.every((region) => region.changedFraction === 0)).toBe(true);
    expect(ids(measurements?.before ?? [])).toEqual(ids(measurements?.after ?? []));
    expect(
      measurements?.after.find((region) => region.regionId === "r1c1")?.changedFraction
    ).toBe(1);
  });

  it("returns null when the frame dimensions differ", () => {
    expect(
      buildSceneConservationMeasurements({
        reference: makeFrame(4, 4),
        candidate: makeFrame(4, 3),
      })
    ).toBeNull();
  });

  it("returns null when a frame is unusable", () => {
    expect(
      buildSceneConservationMeasurements({
        reference: makeFrame(4, 4),
        candidate: { width: 4, height: 4, data: new Uint8ClampedArray(4) },
      })
    ).toBeNull();
  });

  it("carries the mask's exempt region ids", () => {
    const reference = makeFrame(4, 4);
    const candidate = cloneFrame(reference);
    const mask = makeFrame(4, 4);
    setPixel(mask, 0, 0, 255, 255, 255, 255);
    setPixel(mask, 1, 0, 255, 255, 255, 255);

    const measurements = buildSceneConservationMeasurements({
      reference,
      candidate,
      mask,
      options: { rows: 2, columns: 2 },
    });

    expect(measurements?.mask).toEqual({ regionIds: ["r0c0"] });
  });

  it("treats a missing mask as an empty exempt list", () => {
    const reference = makeFrame(4, 4);
    const candidate = cloneFrame(reference);

    const measurements = buildSceneConservationMeasurements({ reference, candidate });

    expect(measurements?.mask).toEqual({ regionIds: [] });
  });
});
