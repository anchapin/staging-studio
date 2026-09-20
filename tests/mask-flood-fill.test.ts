import { describe, it, expect } from "vitest";
import {
  CUTOUT_ALPHA_THRESHOLD,
  maskGridFromAlphaPixels,
  maskGridFromPixels,
  floodFillMask,
  mergeMaskGrids,
} from "@/lib/mask-flood-fill";

const makeRgba = (pixels: Array<[number, number, number, number]>) =>
  new Uint8ClampedArray(pixels.flat());

describe("maskGridFromPixels", () => {
  it("maps white pixels to 1 and black pixels to 0", () => {
    const data = makeRgba([
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
    expect(Array.from(maskGridFromPixels(data, 2, 2))).toEqual([1, 0, 0, 1]);
  });

  it("classifies gray antialiased pixels by luminance threshold", () => {
    const data = makeRgba([
      [100, 100, 100, 255],
      [200, 200, 200, 255],
    ]);
    expect(Array.from(maskGridFromPixels(data, 2, 1))).toEqual([0, 1]);
  });

  it("leaves cells unpainted when the pixel buffer is short", () => {
    // One white pixel's worth of data for a 2x2 grid: only the first cell
    // can be classified; the rest stay unpainted.
    expect(Array.from(maskGridFromPixels(makeRgba([[255, 255, 255, 255]]), 2, 2))).toEqual([
      1, 0, 0, 0,
    ]);
    expect(Array.from(maskGridFromPixels(new Uint8ClampedArray(4), 2, 2))).toEqual([0, 0, 0, 0]);
  });
});

describe("floodFillMask", () => {
  it("fills the region enclosed by a painted outline without touching the outline", () => {
    // 5x5: white ring, black interior and corners... ring is closed, so the
    // seed at the center fills only the 3x3 interior.
    const size = 5;
    const grid = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const onRing = x === 0 || x === size - 1 || y === 0 || y === size - 1;
        grid[y * size + x] = onRing ? 1 : 0;
      }
    }
    const snapshot = grid.slice();

    const result = floodFillMask(grid, size, size, 2, 2);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.filledCount).toBe(9);
    // Interior (including seed) painted.
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        expect(result.mask[y * size + x]).toBe(1);
      }
    }
    // Ring untouched: every cell keeps the value it had before the fill
    // (ring stays 1, and only interior cells transitioned 0 -> 1).
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const onRing = x === 0 || x === size - 1 || y === 0 || y === size - 1;
        expect(result.mask[y * size + x]).toBe(onRing ? snapshot[y * size + x] : 1);
      }
    }
    // Pure: the input grid is not mutated.
    expect(Array.from(grid)).toEqual(Array.from(snapshot));
  });

  it("does not leak past a continuous diagonal-adjacent outline (4-way connectivity)", () => {
    // Barrier of 1s running corner-to-corner diagonally; diagonal contact
    // blocks a 4-way fill, so the top-right triangle stays unpainted.
    const size = 3;
    const grid = new Uint8Array([0, 1, 1, 1, 1, 0, 1, 0, 0]);
    const result = floodFillMask(grid, size, size, 0, 0);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.filledCount).toBe(1);
    expect(Array.from(result.mask)).toEqual([1, 1, 1, 1, 1, 0, 1, 0, 0]);
  });

  it("fills the entire connected unpainted region when the outline is open", () => {
    // An open outline (gap on the right edge): fill leaks to the background.
    const size = 3;
    const grid = new Uint8Array([1, 1, 0, 1, 0, 0, 1, 1, 0]);
    const result = floodFillMask(grid, size, size, 1, 1);
    expect(result).not.toBeNull();
    if (!result) return;
    // Every unpainted cell is 4-connected to the seed through the gap.
    expect(result.filledCount).toBe(4);
    expect(Array.from(result.mask)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("returns null when the seed is already painted", () => {
    const grid = new Uint8Array([1, 0, 0, 0]);
    expect(floodFillMask(grid, 2, 2, 0, 0)).toBeNull();
  });

  it("returns null when the seed is out of bounds", () => {
    const grid = new Uint8Array(4);
    expect(floodFillMask(grid, 2, 2, -1, 0)).toBeNull();
    expect(floodFillMask(grid, 2, 2, 0, -1)).toBeNull();
    expect(floodFillMask(grid, 2, 2, 2, 0)).toBeNull();
    expect(floodFillMask(grid, 2, 2, 0, 2)).toBeNull();
  });

  it("returns null for non-integer seeds", () => {
    const grid = new Uint8Array(4);
    expect(floodFillMask(grid, 2, 2, 0.5, 0)).toBeNull();
    expect(floodFillMask(grid, 2, 2, 0, Number.NaN)).toBeNull();
  });

  it("returns null for empty or malformed grids", () => {
    expect(floodFillMask(new Uint8Array(0), 0, 0, 0, 0)).toBeNull();
    expect(floodFillMask(new Uint8Array(0), 2, 2, 0, 0)).toBeNull();
  });

  it("fills a 1x1 unpainted grid", () => {
    const result = floodFillMask(new Uint8Array([0]), 1, 1, 0, 0);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.filledCount).toBe(1);
    expect(Array.from(result.mask)).toEqual([1]);
  });

  it("fills a rectangular (non-square) region edge-to-edge", () => {
    // 3 wide x 2 tall, all unpainted.
    const result = floodFillMask(new Uint8Array(6), 3, 2, 0, 1);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.filledCount).toBe(6);
    expect(Array.from(result.mask)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

describe("mergeMaskGrids", () => {
  it("paints cells present in either grid (OR semantics)", () => {
    const base = new Uint8Array([1, 0, 0, 0]);
    const addition = new Uint8Array([0, 1, 0, 0]);
    const result = mergeMaskGrids(base, addition);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(Array.from(result.mask)).toEqual([1, 1, 0, 0]);
    expect(result.addedCount).toBe(1);
  });

  it("keeps manual strokes and adds only the segment's new cells", () => {
    const base = new Uint8Array([0, 1, 1, 0]);
    const addition = new Uint8Array([1, 1, 0, 0]);
    const result = mergeMaskGrids(base, addition);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(Array.from(result.mask)).toEqual([1, 1, 1, 0]);
    expect(result.addedCount).toBe(1);
  });

  it("is pure: neither input grid is mutated", () => {
    const base = new Uint8Array([1, 0, 0, 1]);
    const addition = new Uint8Array([0, 0, 1, 0]);
    const baseSnapshot = base.slice();
    const additionSnapshot = addition.slice();
    mergeMaskGrids(base, addition);
    expect(Array.from(base)).toEqual(Array.from(baseSnapshot));
    expect(Array.from(addition)).toEqual(Array.from(additionSnapshot));
  });

  it("returns null when the grids disagree in length", () => {
    expect(mergeMaskGrids(new Uint8Array(4), new Uint8Array(3))).toBeNull();
    expect(mergeMaskGrids(new Uint8Array(0), new Uint8Array(0))).toEqual({
      mask: new Uint8Array(0),
      addedCount: 0,
    });
  });
});

describe("maskGridFromAlphaPixels", () => {
  // Issue #228: SAM 3.1 detection masks are ALPHA cutouts (transparent
  // background, photo-colored object pixels). Luminance would drop every
  // dark-colored object, so classification keys on alpha alone.
  it("classifies on alpha alone, ignoring dark object colors", () => {
    const data = makeRgba([
      [30, 20, 10, 255], // dark sofa pixel — alpha-only says MASKED
      [0, 0, 0, 0], // transparent background
      [255, 255, 255, 255], // bright object pixel
      [10, 10, 10, 200], // near-threshold alpha, dark — MASKED
    ]);
    expect(Array.from(maskGridFromAlphaPixels(data, 2, 2))).toEqual([1, 0, 1, 1]);
  });

  it("drops pixels below the alpha threshold and pins the threshold", () => {
    expect(CUTOUT_ALPHA_THRESHOLD).toBe(128);
    const data = makeRgba([
      [255, 255, 255, 128], // exactly at threshold → masked
      [255, 255, 255, 127], // one below → background
      [0, 0, 0, 255],
      [0, 0, 0, 0],
    ]);
    expect(Array.from(maskGridFromAlphaPixels(data, 2, 2))).toEqual([1, 0, 1, 0]);
  });

  it("leaves cells beyond the available data unpainted", () => {
    const data = makeRgba([
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    // 2 pixels of data for a 2×2 grid: the trailing 2 cells stay 0.
    expect(Array.from(maskGridFromAlphaPixels(data, 2, 2))).toEqual([1, 1, 0, 0]);
  });

  it("is pure: the input buffer is not mutated", () => {
    const data = makeRgba([
      [10, 20, 30, 255],
      [0, 0, 0, 0],
    ]);
    const snapshot = data.slice();
    maskGridFromAlphaPixels(data, 2, 1);
    expect(Array.from(data)).toEqual(Array.from(snapshot));
  });
});
