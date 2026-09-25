import { describe, expect, it } from "vitest";

import { MERGE_PROXIMITY_PX, closeRegion, fillHoles } from "@/lib/mask-postprocess";

/** Builds a Uint8Array grid from rows of '0'/'1' characters (readable fixtures). */
function rows(...lines: string[]): { grid: Uint8Array; width: number; height: number } {
  const height = lines.length;
  const width = lines[0]?.length ?? 0;
  const grid = new Uint8Array(width * height);
  lines.forEach((line, y) => {
    for (let x = 0; x < width; x++) grid[y * width + x] = line[x] === "1" ? 1 : 0;
  });
  return { grid, width, height };
}

describe("fillHoles", () => {
  it("fills the enclosed interior of a ring (donut hole)", () => {
    const { grid, width, height } = rows(
      "11111",
      "10001",
      "10001",
      "10001",
      "11111"
    );

    const result = fillHoles(grid, width, height);
    expect(result).not.toBeNull();
    if (!result) return;
    // The 3x3 interior becomes painted: 9 cells transitioned 0 -> 1.
    expect(result.filledCount).toBe(9);
    // Every cell is painted afterward: ring (16) + filled hole (9) = 25.
    for (let i = 0; i < result.mask.length; i++) expect(result.mask[i]).toBe(1);
    // Pure: the input grid is not mutated (center hole still 0 in the input).
    expect(grid[2 * width + 2]).toBe(0);
  });

  it("leaves an open notch touching the border untouched", () => {
    // C-shape: the interior connects to the outside through the gap on the
    // right edge, so nothing is enclosed and nothing gets filled.
    const { grid, width, height } = rows(
      "11111",
      "10001",
      "10000", // gap in the right wall
      "10001",
      "11111"
    );
    const snapshot = grid.slice();

    const result = fillHoles(grid, width, height);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.filledCount).toBe(0);
    expect(Array.from(result.mask)).toEqual(Array.from(snapshot));
  });

  it("leaves an empty mask and a full mask unchanged", () => {
    const empty = new Uint8Array(12); // 4x3 all background — all connected to border
    const emptyResult = fillHoles(empty, 4, 3);
    expect(emptyResult).not.toBeNull();
    if (emptyResult) {
      expect(emptyResult.filledCount).toBe(0);
      expect(Array.from(emptyResult.mask)).toEqual(Array.from(empty));
    }

    const full = new Uint8Array(12).fill(1); // no background at all
    const fullResult = fillHoles(full, 4, 3);
    expect(fullResult).not.toBeNull();
    if (fullResult) {
      expect(fullResult.filledCount).toBe(0);
      expect(Array.from(fullResult.mask)).toEqual(Array.from(full));
    }
  });

  it("fills a 1x1 hole pocket (no minimum hole size)", () => {
    // 3x3 with a single unpainted pixel fully enclosed by paint.
    const { grid, width, height } = rows(
      "111",
      "101",
      "111"
    );
    const result = fillHoles(grid, width, height);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.filledCount).toBe(1);
    expect(result.mask[1 * width + 1]).toBe(1);
  });

  it("returns null for malformed geometry", () => {
    expect(fillHoles(new Uint8Array(4), 0, 4)).toBeNull();
    expect(fillHoles(new Uint8Array(4), 4, 0)).toBeNull();
    expect(fillHoles(new Uint8Array(4), 2.5, 2)).toBeNull();
    expect(fillHoles(new Uint8Array(3), 2, 2)).toBeNull(); // shorter than w*h
  });
});

describe("closeRegion", () => {
  it("bridges a gap between two shapes when the gap ≤ 2R", () => {
    // Two full-height columns at x=0 and x=4: nearest painted cells are 4
    // apart, so radius 2 (2R = 4) closes the seam at x=1..3.
    const height = 6;
    const width = 8;
    const grid = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      grid[y * width] = 1;
      grid[y * width + 4] = 1;
    }

    const result = closeRegion(grid, width, height, 2);
    expect(result).not.toBeNull();
    if (!result) return;
    // The seam is fully bridged: x=0..4 painted (both columns + the gap).
    for (let y = 1; y < height - 1; y++) {
      for (let x = 0; x <= 4; x++) {
        expect(result.mask[y * width + x]).toBe(1);
      }
    }
    // No expansion beyond R past the right column (original boundary x=4):
    // erosion trims the dilation back to at most R of original paint.
    for (let y = 0; y < height; y++) {
      expect(result.mask[y * width + 6]).toBe(0);
      expect(result.mask[y * width + 7]).toBe(0);
    }
  });

  it("does not bridge a gap wider than 2R and keeps both shapes", () => {
    // Columns at x=0 and x=6: distance 6 > 2R = 4, so no bridging.
    const height = 6;
    const width = 8;
    const grid = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      grid[y * width] = 1;
      grid[y * width + 6] = 1;
    }
    const snapshot = grid.slice();

    const result = closeRegion(grid, width, height, 2);
    expect(result).not.toBeNull();
    if (!result) return;
    // The gap center column stays unpainted.
    for (let y = 0; y < height; y++) expect(result.mask[y * width + 3]).toBe(0);
    // Both original columns survive (interior rows, away from rounding).
    for (let y = 1; y < height - 1; y++) {
      expect(result.mask[y * width]).toBe(1);
      expect(result.mask[y * width + 6]).toBe(1);
    }
    expect(Array.from(grid)).toEqual(Array.from(snapshot)); // pure
  });

  it("never expands the outer boundary beyond R when closing a solid shape", () => {
    // A solid 3x3 square: every cell closing paints must lie within
    // Euclidean distance R=1 of the original paint (AC-1.2), and the
    // square's own cells survive.
    const { grid, width, height } = rows(
      "00000",
      "01110",
      "01110",
      "01110",
      "00000"
    );

    const result = closeRegion(grid, width, height, 1);
    expect(result).not.toBeNull();
    if (!result) return;

    // Original square cells all survive closing.
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        expect(result.mask[y * width + x]).toBe(1);
      }
    }
    // Every painted cell in the result is within distance 1 of the
    // original square (cells x,y ∈ [1,3]).
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (result.mask[y * width + x] !== 1) continue;
        const nearestX = Math.min(Math.max(x, 1), 3);
        const nearestY = Math.min(Math.max(y, 1), 3);
        const dist = Math.hypot(x - nearestX, y - nearestY);
        expect(dist).toBeLessThanOrEqual(1);
      }
    }
  });

  it("returns null for malformed geometry and treats radius 0 as passthrough", () => {
    expect(closeRegion(new Uint8Array(4), 0, 4, 1)).toBeNull();
    expect(closeRegion(new Uint8Array(3), 2, 2, 1)).toBeNull();

    const { grid, width, height } = rows("010", "111", "010");
    const result = closeRegion(grid, width, height, 0);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(Array.from(result.mask)).toEqual(Array.from(grid));
  });
});

describe("MERGE_PROXIMITY_PX", () => {
  it("is pinned at 5 grid pixels (issue #252 D2)", () => {
    expect(MERGE_PROXIMITY_PX).toBe(5);
  });
});
