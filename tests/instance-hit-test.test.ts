import { describe, expect, it } from "vitest";

import { findInstanceAtPoint, instanceSeedPoint, type InstanceMaskGrid } from "@/lib/instance-hit-test";

/** Builds a grid from ASCII rows — `#` = object pixel, `.` = background. */
function gridFromAscii(rows: string[]): InstanceMaskGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const grid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid[y * width + x] = rows[y][x] === "#" ? 1 : 0;
    }
  }
  return { grid, width, height };
}

const LEFT_BLOB = gridFromAscii([
  "##..",
  "##..",
  "....",
]);
const RIGHT_BLOB = gridFromAscii([
  "..##",
  "..##",
  "....",
]);

describe("instanceSeedPoint", () => {
  // Issue #249: "Select all detected" needs a representative point per
  // instance so the batch entries inherit the same duplicate-point rule
  // as click toggles. First set pixel in row-major order is deterministic
  // and always lands inside the instance.
  it("returns the first set pixel in row-major order", () => {
    const blob = gridFromAscii([
      "....",
      ".##.",
      "....",
    ]);
    expect(instanceSeedPoint(blob)).toEqual({ x: 1, y: 1 });
  });

  it("prefers an earlier row over an earlier column", () => {
    const blob = gridFromAscii([
      "..#.",
      "#...",
      "....",
    ]);
    expect(instanceSeedPoint(blob)).toEqual({ x: 2, y: 0 });
  });

  it("returns null for an all-background grid", () => {
    const empty = gridFromAscii(["....", "...."]);
    expect(instanceSeedPoint(empty)).toBeNull();
  });

  it("returns null for degenerate dims or a short grid", () => {
    const zeroDims: InstanceMaskGrid = { grid: new Uint8Array(0), width: 0, height: 0 };
    expect(instanceSeedPoint(zeroDims)).toBeNull();
    const shortGrid: InstanceMaskGrid = { grid: new Uint8Array(2), width: 4, height: 4 };
    expect(instanceSeedPoint(shortGrid)).toBeNull();
  });
});

describe("findInstanceAtPoint", () => {
  it("returns the instance index containing the point", () => {
    const instances = [LEFT_BLOB, RIGHT_BLOB];
    expect(findInstanceAtPoint(instances, { x: 0, y: 0 })).toBe(0);
    expect(findInstanceAtPoint(instances, { x: 3, y: 1 })).toBe(1);
  });

  it("returns null when the point falls on background in every instance", () => {
    const instances = [LEFT_BLOB, RIGHT_BLOB];
    expect(findInstanceAtPoint(instances, { x: 0, y: 2 })).toBeNull(); // bottom row is empty
    expect(findInstanceAtPoint(instances, { x: 1, y: 2 })).toBeNull();
  });

  it("returns null when the point is outside the grid bounds", () => {
    const instances = [LEFT_BLOB];
    expect(findInstanceAtPoint(instances, { x: -1, y: 0 })).toBeNull();
    expect(findInstanceAtPoint(instances, { x: 4, y: 0 })).toBeNull();
    expect(findInstanceAtPoint(instances, { x: 0, y: 3 })).toBeNull();
  });

  it("floors fractional points into the containing cell", () => {
    const instances = [LEFT_BLOB];
    expect(findInstanceAtPoint(instances, { x: 0.9, y: 0.9 })).toBe(0);
    expect(findInstanceAtPoint(instances, { x: 0.9, y: 2.9 })).toBeNull(); // row 2 is background
  });

  it("returns null for non-finite points", () => {
    const instances = [LEFT_BLOB];
    expect(findInstanceAtPoint(instances, { x: Number.NaN, y: 0 })).toBeNull();
    expect(findInstanceAtPoint(instances, { x: 0, y: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("prefers the earlier (better-ranked) instance on overlap", () => {
    const overlay = gridFromAscii(["####", "####", "...."]);
    expect(findInstanceAtPoint([overlay, RIGHT_BLOB], { x: 2, y: 0 })).toBe(0);
    // Same shape, reversed order → the reversed winner changes.
    expect(findInstanceAtPoint([RIGHT_BLOB, overlay], { x: 2, y: 0 })).toBe(0);
  });

  it("returns null for an empty instance list", () => {
    expect(findInstanceAtPoint([], { x: 0, y: 0 })).toBeNull();
  });

  it("skips null (undecodable) entries without shifting later indices", () => {
    const instances: (InstanceMaskGrid | null)[] = [null, RIGHT_BLOB];
    expect(findInstanceAtPoint(instances, { x: 0, y: 0 })).toBeNull();
    expect(findInstanceAtPoint(instances, { x: 3, y: 0 })).toBe(1);
  });

  it("skips degenerate instances (zero dims or short grids)", () => {
    const shortGrid: InstanceMaskGrid = { grid: new Uint8Array(2), width: 4, height: 4 };
    const zeroDims: InstanceMaskGrid = { grid: new Uint8Array(0), width: 0, height: 0 };
    const instances = [shortGrid, zeroDims, LEFT_BLOB];
    expect(findInstanceAtPoint(instances, { x: 0, y: 0 })).toBe(2);
  });
});
