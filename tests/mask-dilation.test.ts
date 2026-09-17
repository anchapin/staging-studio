import { describe, it, expect } from "vitest";
import {
  dilateMaskGrid,
  DEFAULT_MASK_EXPANSION_RADIUS,
  MAX_MASK_EXPANSION_RADIUS,
} from "@/lib/mask-dilation";

const grid5x5 = (cells: number[]) => new Uint8Array(cells);

describe("dilateMaskGrid", () => {
  it("grows a single painted cell into a circular disc of the given radius", () => {
    // 7x7, center cell painted, radius 2: every cell within Euclidean
    // distance 2 of (3,3) becomes painted, corners (distance sqrt(8)) do not.
    const size = 7;
    const grid = grid5x5(new Array(size * size).fill(0));
    grid[3 * size + 3] = 1;

    const result = dilateMaskGrid(grid, size, size, 2);
    expect(result).not.toBeNull();
    if (!result) return;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const distanceSquared = (x - 3) ** 2 + (y - 3) ** 2;
        const expected = distanceSquared <= 4 ? 1 : 0;
        expect(result.mask[y * size + x]).toBe(expected);
      }
    }
    expect(result.paintedCount).toBe(13);
  });

  it("extends a painted region outward without eroding it", () => {
    // 5x5 with a single painted cell at (2,2), radius 1: a plus shape
    // (4-connected neighborhood) around it, original cell still painted.
    const size = 5;
    const grid = grid5x5(new Array(size * size).fill(0));
    grid[2 * size + 2] = 1;

    const result = dilateMaskGrid(grid, size, size, 1);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(Array.from(result.mask)).toEqual([
      0, 0, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 1, 1, 1, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    expect(result.paintedCount).toBe(5);
  });

  it("does not grow diagonally past the radius (circle, not square kernel)", () => {
    // 3x3, center painted, radius 1: corners are at distance sqrt(2) > 1.
    const size = 3;
    const grid = grid5x5([0, 0, 0, 0, 1, 0, 0, 0, 0]);

    const result = dilateMaskGrid(grid, size, size, 1);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(Array.from(result.mask)).toEqual([0, 1, 0, 1, 1, 1, 0, 1, 0]);
  });

  it("is single-pass: newly painted cells never seed further growth", () => {
    // Dilation by 1 of a 1-cell mask spans 2 cells across at most; a
    // chain-growth bug (re-reading the output as sources) would flood the
    // whole grid.
    const size = 7;
    const grid = grid5x5(new Array(size * size).fill(0));
    grid[3 * size + 3] = 1;

    const result = dilateMaskGrid(grid, size, size, 1);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.paintedCount).toBe(5);
  });

  it("passes the grid through byte-for-byte at radius 0", () => {
    const grid = grid5x5([1, 0, 0, 1, 1, 0, 0, 0, 1]);
    const snapshot = grid.slice();

    const result = dilateMaskGrid(grid, 3, 3, 0);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(Array.from(result.mask)).toEqual(Array.from(grid));
    expect(result.paintedCount).toBe(4);
    expect(grid).toEqual(snapshot);
  });

  it("treats a negative or non-finite radius as no expansion", () => {
    const grid = grid5x5([0, 0, 0, 0, 1, 0, 0, 0, 0]);

    for (const radius of [-3, NaN, Infinity]) {
      const result = dilateMaskGrid(grid, 3, 3, radius);
      expect(result).not.toBeNull();
      if (!result) continue;
      expect(Array.from(result.mask)).toEqual(Array.from(grid));
    }
  });

  it("never mutates the input grid (mask-only transform)", () => {
    const grid = grid5x5([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const snapshot = grid.slice();

    const result = dilateMaskGrid(grid, 3, 3, 2);
    expect(result).not.toBeNull();
    expect(grid).toEqual(snapshot);
    // Output is a distinct buffer, not an alias of the input.
    expect(result?.mask).not.toBe(grid);
  });

  it("clamps growth to the grid bounds at every edge and corner", () => {
    // Painted cells flush against all four edges; radius far exceeding the
    // grid must paint every cell exactly once and never throw or wrap.
    const size = 5;
    const grid = grid5x5(new Array(size * size).fill(0));
    grid[0] = 1; // top-left corner
    grid[2 * size + size - 1] = 1; // middle-right edge
    grid[(size - 1) * size + 2] = 1; // bottom edge

    const result = dilateMaskGrid(grid, size, size, 25);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.paintedCount).toBe(size * size);
    for (let i = 0; i < size * size; i++) {
      expect(result.mask[i]).toBe(1);
    }
  });

  it("bounds already-full masks (idempotent on an all-painted grid)", () => {
    const size = 4;
    const grid = grid5x5(new Array(size * size).fill(1));

    const result = dilateMaskGrid(grid, size, size, 3);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(Array.from(result.mask)).toEqual(Array.from(grid));
    expect(result.paintedCount).toBe(size * size);
  });

  it("dilating twice grows by at most the radius again and stays within bounds", () => {
    const size = 21;
    const grid = grid5x5(new Array(size * size).fill(0));
    grid[10 * size + 10] = 1;

    const once = dilateMaskGrid(grid, size, size, 5);
    expect(once).not.toBeNull();
    if (!once) return;
    const twice = dilateMaskGrid(once.mask, size, size, 5);
    expect(twice).not.toBeNull();
    if (!twice) return;

    expect(twice.paintedCount).toBeGreaterThanOrEqual(once.paintedCount);
    expect(twice.paintedCount).toBeLessThan(size * size);
  });

  it("returns null for malformed geometry", () => {
    const grid = grid5x5(new Array(9).fill(0));

    expect(dilateMaskGrid(grid, 0, 3, 1)).toBeNull();
    expect(dilateMaskGrid(grid, 3, 0, 1)).toBeNull();
    expect(dilateMaskGrid(grid, 1.5, 3, 1)).toBeNull();
    expect(dilateMaskGrid(grid, 3, 1.5, 1)).toBeNull();
    expect(dilateMaskGrid(new Uint8Array(4), 3, 3, 1)).toBeNull();
  });

  it("ignores cells beyond width * height in an oversized grid", () => {
    // Grid has extra trailing cells painted; they are outside the declared
    // geometry and must not leak into the result.
    const grid = grid5x5([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1]);

    const result = dilateMaskGrid(grid, 3, 3, 1);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.paintedCount).toBe(5);
  });

  it("exposes the issue #180 defaults", () => {
    expect(DEFAULT_MASK_EXPANSION_RADIUS).toBe(15);
    expect(MAX_MASK_EXPANSION_RADIUS).toBe(25);
  });
});
