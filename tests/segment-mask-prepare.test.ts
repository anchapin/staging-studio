import { describe, it, expect } from "vitest";
import {
  prepareSegmentMaskGrid,
  prepareSegmentMaskBuffer,
} from "@/lib/segment-mask-prepare";
import {
  DEFAULT_SEGMENT_MASK_EROSION_RADIUS,
  MAX_SEGMENT_MASK_EROSION_RADIUS,
  MIN_SEGMENT_MASK_EROSION_RADIUS,
} from "@/lib/mask-erosion";
import { unionMaskBuffers } from "@/lib/multi-select-batch";

const gridOf = (cells: number[]) => new Uint8Array(cells);

const paintRect = (
  grid: Uint8Array,
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): void => {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) grid[y * size + x] = 1;
  }
};

const paintRing = (
  grid: Uint8Array,
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number
): void => {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const onEdge =
        x < x0 + thickness ||
        x > x1 - thickness ||
        y < y0 + thickness ||
        y > y1 - thickness;
      if (onEdge) grid[y * size + x] = 1;
    }
  }
};

describe("prepareSegmentMaskGrid", () => {
  it("drops a 1-px halo ring around a solid block and keeps the interior at the default radius", () => {
    const size = 41;
    // Solid 21x21 block at (10,10)-(30,30) wearing a 1-px painted halo
    // ring just outside it — the over-expanded SAM mask shape of #1457.
    const grid = gridOf(new Array(size * size).fill(0));
    paintRect(grid, size, 10, 10, 30, 30);
    paintRing(grid, size, 9, 9, 31, 31, 1);
    const snapshot = grid.slice();
    expect(snapshot.filter((c) => c === 1).length).toBe(23 * 23);

    const result = prepareSegmentMaskGrid(grid, size, size);
    expect(result).not.toBeNull();
    if (!result) return;

    // Default radius 4 pulls the mask back 4 px on every side: the halo
    // ring and the 4 layers under it are gone, the block interior stays.
    expect(result.paintedCount).toBe(15 * 15);
    // The halo ring itself is gone.
    expect(result.mask[9 * size + 9]).toBe(0);
    expect(result.mask[9 * size + 20]).toBe(0);
    expect(result.mask[20 * size + 31]).toBe(0);
    // ... and so is everything up to the shrunken boundary.
    expect(result.mask[12 * size + 20]).toBe(0);
    expect(result.mask[20 * size + 28]).toBe(0);
    // The interior survives.
    expect(result.mask[13 * size + 13]).toBe(1);
    expect(result.mask[20 * size + 20]).toBe(1);
    expect(result.mask[27 * size + 27]).toBe(1);
    // The input grid is untouched.
    expect(grid).toEqual(snapshot);
  });

  it("returns a hole-free donut", () => {
    const size = 51;
    // A thick painted ring (10 px) around a 21x21 unpainted pocket.
    const grid = gridOf(new Array(size * size).fill(0));
    paintRing(grid, size, 5, 5, 45, 45, 10);

    const result = prepareSegmentMaskGrid(grid, size, size);
    expect(result).not.toBeNull();
    if (!result) return;

    // The ring survives erosion (10 px thick → 6 px), so the pocket stays
    // enclosed and gets filled: the whole 33x33 core is painted.
    expect(result.paintedCount).toBe(33 * 33);
    expect(result.mask[25 * size + 25]).toBe(1);
    expect(result.mask[15 * size + 15]).toBe(1);
    expect(result.mask[35 * size + 35]).toBe(1);
    // Nothing of the original hole is left unpainted.
    expect(result.mask.slice(15 * size + 15, 15 * size + 36).every((c) => c === 1)).toBe(true);
    // The area outside the (shrunken) ring stays unpainted.
    expect(result.mask[0]).toBe(0);
    expect(result.mask[2 * size + 2]).toBe(0);
  });

  it("is a byte-identical passthrough with erosion 0, closing off and hole fill off", () => {
    const size = 5;
    const grid = gridOf([
      1, 1, 0, 0, 1,
      1, 0, 0, 1, 0,
      0, 0, 1, 0, 0,
      0, 1, 0, 0, 1,
      1, 0, 0, 1, 0,
    ]);
    const snapshot = grid.slice();

    const result = prepareSegmentMaskGrid(grid, size, size, {
      erosionRadius: 0,
      closingRadius: 0,
      fillHoles: false,
    });
    expect(result).not.toBeNull();
    if (!result) return;

    expect(Array.from(result.mask)).toEqual(Array.from(snapshot));
    expect(result.paintedCount).toBe(snapshot.filter((c) => c === 1).length);
    expect(grid).toEqual(snapshot);
  });

  it("erases a thin 1-px feature entirely and returns an all-zero grid, not null", () => {
    const size = 9;
    const grid = gridOf(new Array(size * size).fill(0));
    // A single painted cell — nothing is left after the default erosion.
    grid[4 * size + 4] = 1;
    const snapshot = grid.slice();

    const result = prepareSegmentMaskGrid(grid, size, size);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.paintedCount).toBe(0);
    expect(Array.from(result.mask)).toEqual(new Array(size * size).fill(0));
    expect(grid).toEqual(snapshot);
  });

  it("erases a 1-px line feature entirely and returns an all-zero grid", () => {
    const size = 9;
    const grid = gridOf(new Array(size * size).fill(0));
    for (let y = 0; y < size; y++) grid[y * size + 4] = 1;

    const result = prepareSegmentMaskGrid(grid, size, size);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.paintedCount).toBe(0);
    expect(Array.from(result.mask)).toEqual(new Array(size * size).fill(0));
  });

  it("never mutates the input grid and always returns a fresh buffer", () => {
    const size = 11;
    const grid = gridOf(new Array(size * size).fill(0));
    paintRect(grid, size, 2, 2, 8, 8);
    const snapshot = grid.slice();

    const result = prepareSegmentMaskGrid(grid, size, size);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(grid).toEqual(snapshot);
    expect(result.mask).not.toBe(grid);
  });

  it("closes gaps only when a closing radius is passed", () => {
    const size = 11;
    // Two blocks separated by a 1-px gap.
    const grid = gridOf(new Array(size * size).fill(0));
    paintRect(grid, size, 1, 3, 4, 7);
    paintRect(grid, size, 6, 3, 9, 7);

    const withoutClosing = prepareSegmentMaskGrid(grid, size, size, {
      erosionRadius: 0,
      fillHoles: false,
    });
    expect(withoutClosing).not.toBeNull();
    if (!withoutClosing) return;
    expect(withoutClosing.mask[5 * size + 5]).toBe(0);

    const withClosing = prepareSegmentMaskGrid(grid, size, size, {
      erosionRadius: 0,
      closingRadius: 1,
      fillHoles: false,
    });
    expect(withClosing).not.toBeNull();
    if (!withClosing) return;
    expect(withClosing.mask[5 * size + 5]).toBe(1);
  });

  it("keeps holes when fillHoles is false", () => {
    const size = 21;
    const grid = gridOf(new Array(size * size).fill(0));
    paintRing(grid, size, 0, 0, 20, 20, 5);

    const kept = prepareSegmentMaskGrid(grid, size, size, {
      erosionRadius: 0,
      fillHoles: false,
    });
    expect(kept).not.toBeNull();
    if (!kept) return;
    expect(kept.mask[10 * size + 10]).toBe(0);

    const filled = prepareSegmentMaskGrid(grid, size, size, { erosionRadius: 0 });
    expect(filled).not.toBeNull();
    if (!filled) return;
    expect(filled.mask[10 * size + 10]).toBe(1);
  });

  it("clamps the erosion radius to the exported sweep bounds", () => {
    const size = 41;
    const grid = gridOf(new Array(size * size).fill(0));
    paintRect(grid, size, 10, 10, 30, 30);

    const clampedHigh = prepareSegmentMaskGrid(grid, size, size, {
      erosionRadius: MAX_SEGMENT_MASK_EROSION_RADIUS + 10,
    });
    expect(clampedHigh).not.toBeNull();
    if (!clampedHigh) return;

    const atMax = prepareSegmentMaskGrid(grid, size, size, {
      erosionRadius: MAX_SEGMENT_MASK_EROSION_RADIUS,
    });
    expect(atMax).not.toBeNull();
    if (!atMax) return;

    expect(Array.from(clampedHigh.mask)).toEqual(Array.from(atMax.mask));
    expect(clampedHigh.paintedCount).toBe(atMax.paintedCount);
  });

  it("treats a negative or non-finite erosion radius as no erosion", () => {
    const size = 5;
    const grid = gridOf([
      1, 1, 0, 0, 1,
      1, 0, 0, 1, 0,
      0, 0, 1, 0, 0,
      0, 1, 0, 0, 1,
      1, 0, 0, 1, 0,
    ]);

    for (const radius of [-3, NaN, Infinity]) {
      const result = prepareSegmentMaskGrid(grid, size, size, {
        erosionRadius: radius,
        fillHoles: false,
      });
      expect(result).not.toBeNull();
      if (!result) continue;
      expect(Array.from(result.mask)).toEqual(Array.from(grid));
    }
  });

  it("uses the documented default erosion radius", () => {
    const size = 41;
    const grid = gridOf(new Array(size * size).fill(0));
    paintRect(grid, size, 10, 10, 30, 30);

    const implicit = prepareSegmentMaskGrid(grid, size, size);
    const explicit = prepareSegmentMaskGrid(grid, size, size, {
      erosionRadius: DEFAULT_SEGMENT_MASK_EROSION_RADIUS,
    });
    expect(implicit).not.toBeNull();
    expect(explicit).not.toBeNull();
    if (!implicit || !explicit) return;
    expect(Array.from(implicit.mask)).toEqual(Array.from(explicit.mask));
    expect(DEFAULT_SEGMENT_MASK_EROSION_RADIUS).toBe(4);
    expect(MIN_SEGMENT_MASK_EROSION_RADIUS).toBe(0);
    expect(MAX_SEGMENT_MASK_EROSION_RADIUS).toBe(6);
  });

  it("returns null for malformed geometry", () => {
    const grid = gridOf(new Array(9).fill(0));

    expect(prepareSegmentMaskGrid(grid, 0, 3)).toBeNull();
    expect(prepareSegmentMaskGrid(grid, 3, 0)).toBeNull();
    expect(prepareSegmentMaskGrid(grid, 1.5, 3)).toBeNull();
    expect(prepareSegmentMaskGrid(grid, 3, 1.5)).toBeNull();
    expect(prepareSegmentMaskGrid(new Uint8Array(4), 3, 3)).toBeNull();
  });

  it("ignores cells beyond width * height in an oversized grid", () => {
    const size = 3;
    const grid = gridOf([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1]);

    const result = prepareSegmentMaskGrid(grid, size, size);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.mask.length).toBe(size * size);
    expect(result.paintedCount).toBe(0);
  });
});

describe("prepareSegmentMaskBuffer", () => {
  it("returns the white-on-black RGBA shape unionMaskBuffers consumes", () => {
    const size = 9;
    const grid = gridOf(new Array(size * size).fill(0));
    paintRect(grid, size, 2, 2, 6, 6);

    const buffer = prepareSegmentMaskBuffer(grid, size, size, {
      erosionRadius: 0,
      closingRadius: 0,
      fillHoles: false,
    });
    expect(buffer).not.toBeNull();
    if (!buffer) return;

    expect(buffer.width).toBe(size);
    expect(buffer.height).toBe(size);
    expect(buffer.data.length).toBe(size * size * 4);

    // Painted cell → opaque white; unpainted cell → opaque black.
    const painted = buffer.data[(4 * size + 4) * 4];
    expect([painted, buffer.data[(4 * size + 4) * 4 + 1], buffer.data[(4 * size + 4) * 4 + 2]]).toEqual([
      255, 255, 255,
    ]);
    expect(buffer.data[(4 * size + 4) * 4 + 3]).toBe(255);
    const unpainted = buffer.data[(0 * size + 0) * 4];
    expect(unpainted).toBe(0);
    expect(buffer.data[(0 * size + 0) * 4 + 3]).toBe(255);
  });

  it("feeds unionMaskBuffers directly", () => {
    const size = 9;
    const left = gridOf(new Array(size * size).fill(0));
    paintRect(left, size, 0, 3, 3, 5);
    const right = gridOf(new Array(size * size).fill(0));
    paintRect(right, size, 5, 3, 8, 5);

    const leftBuffer = prepareSegmentMaskBuffer(left, size, size, { erosionRadius: 0 });
    const rightBuffer = prepareSegmentMaskBuffer(right, size, size, { erosionRadius: 0 });
    expect(leftBuffer).not.toBeNull();
    expect(rightBuffer).not.toBeNull();
    if (!leftBuffer || !rightBuffer) return;

    const union = unionMaskBuffers([leftBuffer, rightBuffer]);
    expect(union).not.toBeNull();
    if (!union) return;
    expect(union.width).toBe(size);
    expect(union.height).toBe(size);
    // Both objects are painted white in the union.
    expect(union.data[(4 * size + 1) * 4]).toBe(255);
    expect(union.data[(4 * size + 7) * 4]).toBe(255);
    expect(union.data[(4 * size + 4) * 4]).toBe(0);
  });

  it("applies the same preparation as the grid function", () => {
    const size = 41;
    const grid = gridOf(new Array(size * size).fill(0));
    paintRect(grid, size, 10, 10, 30, 30);
    paintRing(grid, size, 9, 9, 31, 31, 1);

    const prepared = prepareSegmentMaskGrid(grid, size, size);
    const buffer = prepareSegmentMaskBuffer(grid, size, size);
    expect(prepared).not.toBeNull();
    expect(buffer).not.toBeNull();
    if (!prepared || !buffer) return;

    let painted = 0;
    for (let i = 0; i < size * size; i++) {
      if (buffer.data[i * 4] === 255) painted++;
    }
    expect(painted).toBe(prepared.paintedCount);
    expect(prepared.paintedCount).toBe(15 * 15);
  });

  it("returns null for malformed geometry", () => {
    const grid = gridOf(new Array(9).fill(0));
    expect(prepareSegmentMaskBuffer(grid, 0, 3)).toBeNull();
    expect(prepareSegmentMaskBuffer(new Uint8Array(4), 3, 3)).toBeNull();
  });
});
