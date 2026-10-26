import { describe, it, expect } from "vitest";
import {
  erodeMaskGrid,
  erodeSegmentMask,
  DEFAULT_SEGMENT_MASK_EROSION_RADIUS,
  MIN_SEGMENT_MASK_EROSION_RADIUS,
  MAX_SEGMENT_MASK_EROSION_RADIUS,
} from "@/lib/mask-erosion";
import { dilateMaskGrid } from "@/lib/mask-dilation";

const gridOf = (cells: number[]) => new Uint8Array(cells);

describe("erodeMaskGrid", () => {
  it("shrinks a painted region inward by the given radius", () => {
    // 5x5 with a solid 3x3 painted block in the middle, radius 1: only the
    // centre cell survives (its 4-neighbourhood is fully painted).
    const size = 5;
    const grid = gridOf(new Array(size * size).fill(0));
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) grid[y * size + x] = 1;
    }

    const result = erodeMaskGrid(grid, size, size, 1);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(Array.from(result.mask)).toEqual([
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    expect(result.paintedCount).toBe(1);
  });

  it("removes a single painted cell at radius 1 (nothing to erode into)", () => {
    const grid = gridOf([0, 0, 0, 0, 1, 0, 0, 0, 0]);

    const result = erodeMaskGrid(grid, 3, 3, 1);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(Array.from(result.mask)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.paintedCount).toBe(0);
  });

  it("erodes with a circular kernel (radius 1 keeps the 4-neighbourhood)", () => {
    // 3x3 fully painted: at radius 1 every cell's in-grid 4-neighbourhood
    // is painted, so nothing is removed (the corners' missing diagonal
    // neighbours are outside the radius-1 disc).
    const grid = gridOf(new Array(9).fill(1));

    const result = erodeMaskGrid(grid, 3, 3, 1);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(Array.from(result.mask)).toEqual(Array.from(grid));
    expect(result.paintedCount).toBe(9);
  });

  it("erodes with a circular kernel at radius 2", () => {
    // 5x5 with a one-pixel-tall painted line across the middle: at radius
    // 2 every line cell sees unpainted cells inside its disc, so the whole
    // line vanishes.
    const size = 5;
    const grid = gridOf(new Array(size * size).fill(0));
    grid[2 * size + 0] = 1;
    grid[2 * size + 1] = 1;
    grid[2 * size + 2] = 1;
    grid[2 * size + 3] = 1;
    grid[2 * size + 4] = 1;

    const result = erodeMaskGrid(grid, size, size, 2);
    expect(result).not.toBeNull();
    if (!result) return;
    // Every arm cell sees an unpainted neighbour within radius 2, so the
    // whole one-pixel-tall line vanishes.
    expect(result.paintedCount).toBe(0);
  });

  it("makes thin features vanish", () => {
    // 7x7 with a one-pixel-wide vertical line through the centre.
    const size = 7;
    const grid = gridOf(new Array(size * size).fill(0));
    for (let y = 0; y < size; y++) grid[y * size + 3] = 1;

    const result = erodeMaskGrid(grid, size, size, 1);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.paintedCount).toBe(0);

    // A two-pixel-wide bar survives only in its inner column.
    const bar = gridOf(new Array(size * size).fill(0));
    for (let y = 0; y < size; y++) {
      bar[y * size + 2] = 1;
      bar[y * size + 3] = 1;
    }
    const barResult = erodeMaskGrid(bar, size, size, 1);
    expect(barResult).not.toBeNull();
    if (!barResult) return;
    expect(barResult.paintedCount).toBe(0);
  });

  it("passes the grid through byte-for-byte at radius 0", () => {
    const grid = gridOf([1, 0, 0, 1, 1, 0, 0, 0, 1]);
    const snapshot = grid.slice();

    const result = erodeMaskGrid(grid, 3, 3, 0);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(Array.from(result.mask)).toEqual(Array.from(grid));
    expect(result.paintedCount).toBe(4);
    expect(grid).toEqual(snapshot);
  });

  it("treats a negative or non-finite radius as no erosion", () => {
    const grid = gridOf([0, 0, 0, 0, 1, 0, 0, 0, 0]);

    for (const radius of [-3, NaN, Infinity]) {
      const result = erodeMaskGrid(grid, 3, 3, radius);
      expect(result).not.toBeNull();
      if (!result) continue;
      expect(Array.from(result.mask)).toEqual(Array.from(grid));
    }
  });

  it("never mutates the input grid (mask-only transform)", () => {
    const grid = gridOf([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const snapshot = grid.slice();

    const result = erodeMaskGrid(grid, 3, 3, 1);
    expect(result).not.toBeNull();
    expect(grid).toEqual(snapshot);
    // Output is a distinct buffer, not an alias of the input.
    expect(result?.mask).not.toBe(grid);
  });

  it("is the inverse of dilation for an interior shape", () => {
    // erode(dilate(x)) === x for a shape that fits inside the grid with
    // room for the disc — the property that makes the two consistent
    // operators on the same kernel.
    const size = 11;
    const grid = gridOf(new Array(size * size).fill(0));
    grid[5 * size + 5] = 1;

    const dilated = dilateMaskGrid(grid, size, size, 2);
    expect(dilated).not.toBeNull();
    if (!dilated) return;

    const eroded = erodeMaskGrid(dilated.mask, size, size, 2);
    expect(eroded).not.toBeNull();
    if (!eroded) return;

    expect(Array.from(eroded.mask)).toEqual(Array.from(grid));
    expect(eroded.paintedCount).toBe(1);
  });

  it("never grows the painted area", () => {
    const size = 9;
    const grid = gridOf(new Array(size * size).fill(0));
    for (let y = 2; y <= 6; y++) {
      for (let x = 2; x <= 6; x++) grid[y * size + x] = 1;
    }

    const result = erodeMaskGrid(grid, size, size, 2);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.paintedCount).toBeLessThan(25);
    expect(result.paintedCount).toBeGreaterThan(0);
  });

  it("returns null for malformed geometry", () => {
    const grid = gridOf(new Array(9).fill(0));

    expect(erodeMaskGrid(grid, 0, 3, 1)).toBeNull();
    expect(erodeMaskGrid(grid, 3, 0, 1)).toBeNull();
    expect(erodeMaskGrid(grid, 1.5, 3, 1)).toBeNull();
    expect(erodeMaskGrid(grid, 3, 1.5, 1)).toBeNull();
    expect(erodeMaskGrid(new Uint8Array(4), 3, 3, 1)).toBeNull();
  });

  it("ignores cells beyond width * height in an oversized grid", () => {
    const grid = gridOf([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1]);

    const result = erodeMaskGrid(grid, 3, 3, 1);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.paintedCount).toBe(0);
  });

  it("exposes the issue #1457 defaults", () => {
    expect(DEFAULT_SEGMENT_MASK_EROSION_RADIUS).toBe(4);
    expect(MIN_SEGMENT_MASK_EROSION_RADIUS).toBe(0);
    expect(MAX_SEGMENT_MASK_EROSION_RADIUS).toBe(6);
  });
});

describe("erodeSegmentMask", () => {
  it("erodes with the default radius when none is given", () => {
    // 11x11 with a solid 9x9 painted block: at the default radius of 4
    // only the single centre cell survives (its radius-4 disc fits inside
    // the block); the un-eroded block has 81 painted cells.
    const size = 11;
    const grid = gridOf(new Array(size * size).fill(0));
    for (let y = 1; y <= 9; y++) {
      for (let x = 1; x <= 9; x++) grid[y * size + x] = 1;
    }

    const result = erodeSegmentMask(grid, size, size);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.paintedCount).toBe(1);

    const explicit = erodeSegmentMask(grid, size, size, DEFAULT_SEGMENT_MASK_EROSION_RADIUS);
    expect(explicit).not.toBeNull();
    if (!explicit) return;
    expect(Array.from(explicit.mask)).toEqual(Array.from(result.mask));
  });

  it("passes the mask through untouched when the radius is 0", () => {
    const grid = gridOf([1, 0, 0, 1, 1, 0, 0, 0, 1]);

    const result = erodeSegmentMask(grid, 3, 3, 0);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(Array.from(result.mask)).toEqual(Array.from(grid));
    expect(result.paintedCount).toBe(4);
  });

  it("returns null for malformed geometry", () => {
    const grid = gridOf(new Array(9).fill(0));

    expect(erodeSegmentMask(grid, 0, 3)).toBeNull();
    expect(erodeSegmentMask(grid, 3, 0)).toBeNull();
    expect(erodeSegmentMask(grid, 1.5, 3)).toBeNull();
    expect(erodeSegmentMask(new Uint8Array(4), 3, 3)).toBeNull();
  });
});
