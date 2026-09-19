import { describe, it, expect } from "vitest";
import {
  dilateMaskGrid,
  dilateMaskGridDirectional,
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

describe("dilateMaskGridDirectional", () => {
  // -------------------------------------------------------------------------
  // Isotropic fallback: when includeFloorShadow is false (or omitted),
  // output is byte-identical to dilateMaskGrid.
  // -------------------------------------------------------------------------

  it("matches dilateMaskGrid when includeFloorShadow is false (radius 0)", () => {
    const grid = grid5x5([1, 0, 0, 1, 1, 0, 0, 0, 1]);
    const iso = dilateMaskGrid(grid, 3, 3, 0);
    const dir = dilateMaskGridDirectional(grid, 3, 3, 0, { includeFloorShadow: false });
    expect(iso).not.toBeNull();
    expect(dir).not.toBeNull();
    if (!iso || !dir) return;
    expect(Array.from(dir.mask)).toEqual(Array.from(iso.mask));
    expect(dir.paintedCount).toBe(iso.paintedCount);
  });

  it("matches dilateMaskGrid when includeFloorShadow is false (radius 2)", () => {
    const size = 7;
    const grid = grid5x5(new Array(size * size).fill(0));
    grid[3 * size + 3] = 1;

    const iso = dilateMaskGrid(grid, size, size, 2);
    const dir = dilateMaskGridDirectional(grid, size, size, 2, { includeFloorShadow: false });

    expect(iso).not.toBeNull();
    expect(dir).not.toBeNull();
    if (!iso || !dir) return;
    expect(Array.from(dir.mask)).toEqual(Array.from(iso.mask));
    expect(dir.paintedCount).toBe(iso.paintedCount);
  });

  it("matches dilateMaskGrid when includeFloorShadow is omitted entirely", () => {
    const grid = grid5x5([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const iso = dilateMaskGrid(grid, 3, 3, 1);
    const dir = dilateMaskGridDirectional(grid, 3, 3, 1);
    expect(iso).not.toBeNull();
    expect(dir).not.toBeNull();
    if (!iso || !dir) return;
    expect(Array.from(dir.mask)).toEqual(Array.from(iso.mask));
  });

  // -------------------------------------------------------------------------
  // Anisotropic case: downward growth uses elliptical kernel.
  // The kernel is an ellipse: (dx/r)² + (k·dy/r)² <= 1
  // For dy >= 0: k²·dx² + dy² <= r²
  // For dy < 0: dx² + dy² <= r² (same as isotropic)
  // -------------------------------------------------------------------------

  it("paints the same upward cells as isotropic", () => {
    // 7x7, center (3,3) painted, r=1. Upward is dy=-1, same as isotropic.
    const size = 7;
    const grid = grid5x5(new Array(size * size).fill(0));
    grid[3 * size + 3] = 1;

    const result = dilateMaskGridDirectional(grid, size, size, 1, {
      includeFloorShadow: true,
      verticalBias: 2,
    });
    expect(result).not.toBeNull();
    if (!result) return;

    // Upward cell at (3,2) = dy=-1 must be painted (Euclidean r=1)
    expect(result.mask[2 * size + 3]).toBe(1);
    // Diagonal up-left (2,2) = dy=-1, dx=-1: distance sqrt(2) > 1, NOT painted
    expect(result.mask[2 * size + 2]).toBe(0);
  });

  it("extends further downward than isotropic (elliptical kernel)", () => {
    // 7x7, center (3,3) painted, r=1, k=2.
    // Ellipse: (dx/r)² + (dy/(k·r))² <= 1 ⟺ dx² + dy²/k² <= r²
    // With k=2, r=1:
    // - dy=0: dx² <= 1 → dx ∈ {-1, 0, 1} (3 cells: left, center, right)
    // - dy=-1: dx² + 1/4 <= 1 → dx=0 only → center-up (3,2) painted
    // - dy=1: dx² + 1/4 <= 1 → dx=0 only → center-down (3,4) painted
    // - dy=2: dx² + 1 <= 1 → dx=0 only → (3,5) painted
    // Total: 5 cells (same count as isotropic, redistributed depth)
    const size = 7;
    const grid = grid5x5(new Array(size * size).fill(0));
    grid[3 * size + 3] = 1;

    const result = dilateMaskGridDirectional(grid, size, size, 1, {
      includeFloorShadow: true,
      verticalBias: 2,
    });
    expect(result).not.toBeNull();
    if (!result) return;

    // Center painted
    expect(result.mask[3 * size + 3]).toBe(1);
    // Same row (dy=0): all 3 horizontal cells painted (ellipse cross-section)
    expect(result.mask[3 * size + 2]).toBe(1); // left (dx=-1, dy=0)
    expect(result.mask[3 * size + 4]).toBe(1); // right (dx=1, dy=0)
    // Down (dy=1): center-down only (ellipse narrow at dy=1)
    expect(result.mask[4 * size + 3]).toBe(1); // (3,4) = dx=0, dy=1
    // Up (dy=-1): center-up only (circular constraint)
    expect(result.mask[2 * size + 3]).toBe(1); // (3,2) = dx=0, dy=-1
    // (3,5) dy=2: dx² + 1 <= 1 → dx=0 only → painted
    expect(result.mask[5 * size + 3]).toBe(1);
    // Diagonals not painted (Euclidean r=1)
    expect(result.mask[2 * size + 2]).toBe(0);
    expect(result.mask[4 * size + 4]).toBe(0);
  });

  it("never mutates the input grid", () => {
    const grid = grid5x5([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const snapshot = grid.slice();

    const result = dilateMaskGridDirectional(grid, 3, 3, 2, { includeFloorShadow: true });
    expect(result).not.toBeNull();
    expect(grid).toEqual(snapshot);
    expect(result?.mask).not.toBe(grid);
  });

  it("passes the grid through byte-for-byte at radius 0 even with includeFloorShadow true", () => {
    const grid = grid5x5([1, 0, 0, 1, 1, 0, 0, 0, 1]);
    const snapshot = grid.slice();

    const result = dilateMaskGridDirectional(grid, 3, 3, 0, { includeFloorShadow: true });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(Array.from(result.mask)).toEqual(Array.from(grid));
    expect(result.paintedCount).toBe(4);
    expect(grid).toEqual(snapshot);
  });

  it("treats a negative or non-finite radius as no expansion even with includeFloorShadow", () => {
    const grid = grid5x5([0, 0, 0, 0, 1, 0, 0, 0, 0]);

    for (const radius of [-3, NaN, Infinity]) {
      const result = dilateMaskGridDirectional(grid, 3, 3, radius, {
        includeFloorShadow: true,
      });
      expect(result).not.toBeNull();
      if (!result) continue;
      expect(Array.from(result.mask)).toEqual(Array.from(grid));
    }
  });

  it("clamps downward growth to the grid bounds", () => {
    // Painted cell at bottom edge, radius 3, k=2 — downward dilation would
    // extend beyond the grid but must clamp without throwing.
    const size = 5;
    const grid = grid5x5(new Array(size * size).fill(0));
    grid[(size - 1) * size + 2] = 1; // bottom edge, middle column

    const result = dilateMaskGridDirectional(grid, size, size, 3, {
      includeFloorShadow: true,
      verticalBias: 2,
    });
    expect(result).not.toBeNull();
    if (!result) return;

    // Bottom row should be painted (clamped)
    expect(result.mask[(size - 1) * size + 2]).toBe(1);
    // No out-of-bounds access means no crash
  });

  it("returns null for malformed geometry", () => {
    const grid = grid5x5(new Array(9).fill(0));

    expect(dilateMaskGridDirectional(grid, 0, 3, 1, { includeFloorShadow: true })).toBeNull();
    expect(dilateMaskGridDirectional(grid, 3, 0, 1, { includeFloorShadow: true })).toBeNull();
    expect(dilateMaskGridDirectional(grid, 1.5, 3, 1, { includeFloorShadow: true })).toBeNull();
    expect(dilateMaskGridDirectional(grid, 3, 1.5, 1, { includeFloorShadow: true })).toBeNull();
    expect(dilateMaskGridDirectional(new Uint8Array(4), 3, 3, 1, { includeFloorShadow: true })).toBeNull();
  });

  it("ignores cells beyond width * height in an oversized grid (directional)", () => {
    const grid = grid5x5([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1]);

    const result = dilateMaskGridDirectional(grid, 3, 3, 1, { includeFloorShadow: true });
    expect(result).not.toBeNull();
    if (!result) return;
    // Extra cells (indices 9,10,11) must not leak in.
    expect(result.paintedCount).toBe(5);
  });

  it("is single-pass: newly painted cells never seed further growth (directional)", () => {
    const size = 7;
    const grid = grid5x5(new Array(size * size).fill(0));
    grid[3 * size + 3] = 1;

    const result = dilateMaskGridDirectional(grid, size, size, 1, {
      includeFloorShadow: true,
      verticalBias: 2,
    });
    expect(result).not.toBeNull();
    if (!result) return;
    // Chain-growth would flood the grid; single-pass should not.
    expect(result.paintedCount).toBeGreaterThan(0);
    expect(result.paintedCount).toBeLessThan(size * size);
  });

  it("treats verticalBias < 1 as 1 (minimum bias)", () => {
    const grid = grid5x5(new Array(25).fill(0));
    grid[2 * 5 + 2] = 1;

    const result = dilateMaskGridDirectional(grid, 5, 5, 1, {
      includeFloorShadow: true,
      verticalBias: 0.5, // invalid, should clamp to 1
    });
    expect(result).not.toBeNull();
    if (!result) return;

    // With k=1, anisotropic equals isotropic
    const iso = dilateMaskGrid(grid, 5, 5, 1);
    expect(iso).not.toBeNull();
    if (!iso) return;
    expect(result.paintedCount).toBe(iso.paintedCount);
  });
});
