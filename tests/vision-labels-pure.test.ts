import { describe, expect, it } from "vitest";

import {
  hashImageUrl,
  joinRegionLabels,
  maskBounds,
  resolveRegionLabel,
  topmostLeftmostPoint,
} from "@/lib/vision-labels-pure";

/** Build a row-major grid from an ASCII map where `#` is painted. */
function gridFromAscii(rows: string[]): { grid: Uint8Array; width: number; height: number } {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const grid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      grid[y * width + x] = rows[y][x] === "#" ? 1 : 0;
    }
  }
  return { grid, width, height };
}

describe("joinRegionLabels", () => {
  it("returns a single label singular, with no join", () => {
    expect(joinRegionLabels(["chair"])).toBe("chair");
  });

  it("joins two labels with a plain 'and'", () => {
    expect(joinRegionLabels(["sofa", "coffee table"])).toBe("sofa and coffee table");
  });

  it("joins three or more as an Oxford-style list", () => {
    expect(joinRegionLabels(["sofa", "lamp", "rug"])).toBe("sofa, lamp, and rug");
    expect(joinRegionLabels(["a", "b", "c", "d"])).toBe("a, b, c, and d");
  });

  it("preserves first-seen order rather than sorting", () => {
    expect(joinRegionLabels(["zebra", "apple"])).toBe("zebra and apple");
  });

  it("de-dupes repeated labels, so a fused pair stays singular", () => {
    expect(joinRegionLabels(["chair", "chair"])).toBe("chair");
    expect(joinRegionLabels(["chair", "chair", "chair"])).toBe("chair");
  });

  it("trims whitespace and drops empty / whitespace-only entries", () => {
    expect(joinRegionLabels(["  chair  ", "", "   ", "lamp"])).toBe("chair and lamp");
  });

  it("is case-sensitive when de-duping", () => {
    expect(joinRegionLabels(["Chair", "chair"])).toBe("Chair and chair");
  });

  it("returns an empty string when nothing survives", () => {
    expect(joinRegionLabels([])).toBe("");
    expect(joinRegionLabels(["", "  "])).toBe("");
  });

  it("treats null and undefined entries as absent", () => {
    expect(joinRegionLabels([null, "lamp", undefined])).toBe("lamp");
    expect(joinRegionLabels([null, undefined])).toBe("");
  });
});

describe("resolveRegionLabel", () => {
  it("prefers the joined member labels when present", () => {
    expect(resolveRegionLabel(["sofa", "lamp"], "seating")).toBe("sofa and lamp");
  });

  it("falls back to the concept when no member labels exist", () => {
    expect(resolveRegionLabel([], "seating")).toBe("seating");
    expect(resolveRegionLabel([null, undefined, ""], "seating")).toBe("seating");
  });

  it("trims the concept fallback", () => {
    expect(resolveRegionLabel([], "  seating  ")).toBe("seating");
  });

  it("returns an empty string only when both the labels and the concept are blank", () => {
    expect(resolveRegionLabel([], "")).toBe("");
    expect(resolveRegionLabel([], "   ")).toBe("");
  });
});

describe("maskBounds", () => {
  it("returns the tight bounds of the painted cells", () => {
    const { grid, width, height } = gridFromAscii([
      ".....",
      ".###.",
      ".###.",
      ".....",
    ]);
    // Bounds are inclusive painted-cell coordinates: rows 1 and 2 are painted,
    // so maxY is 2, not 3.
    expect(maskBounds(grid, width, height)).toEqual({ minX: 1, minY: 1, maxX: 3, maxY: 2 });
  });

  it("includes single painted cells at the grid extremes", () => {
    const { grid, width, height } = gridFromAscii(["....", "...#", "....", "#..."]);
    expect(maskBounds(grid, width, height)).toEqual({ minX: 0, minY: 1, maxX: 3, maxY: 3 });
  });

  it("returns a single-pixel box for a lone painted cell", () => {
    const { grid, width, height } = gridFromAscii(["...", ".#.", "..."]);
    expect(maskBounds(grid, width, height)).toEqual({ minX: 1, minY: 1, maxX: 1, maxY: 1 });
  });

  it("returns null for an empty mask", () => {
    const { grid, width, height } = gridFromAscii(["...", "...", "..."]);
    expect(maskBounds(grid, width, height)).toBeNull();
  });

  it("treats a fully painted grid as spanning the whole canvas", () => {
    const { grid, width, height } = gridFromAscii(["##", "##"]);
    expect(maskBounds(grid, width, height)).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  it.each([
    ["zero width", 0, 2],
    ["zero height", 2, 0],
    ["negative width", -1, 2],
  ])("returns null for %s", (_label, width, height) => {
    const { grid } = gridFromAscii(["#"]);
    expect(maskBounds(grid, width, height)).toBeNull();
  });

  it("returns null when the grid is shorter than width*height", () => {
    const short = new Uint8Array(3);
    expect(maskBounds(short, 4, 4)).toBeNull();
  });

  it("ignores non-1 cell values rather than treating them as painted", () => {
    // Row 1, col 1 holds 2; only the 1 at (0,0) is painted.
    const grid = new Uint8Array(4);
    grid[0] = 1;
    grid[2] = 2;
    expect(maskBounds(grid, 2, 2)).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe("topmostLeftmostPoint", () => {
  it("anchors at the topmost row, then the leftmost cell in it", () => {
    const { grid, width, height } = gridFromAscii(["...#", "..#.", ".##."]);
    expect(topmostLeftmostPoint(grid, width, height)).toEqual({ x: 3, y: 0 });
  });

  it("prefers a higher row over a leftmost cell further down", () => {
    const { grid, width, height } = gridFromAscii(["....", "#...", "#..."]);
    expect(topmostLeftmostPoint(grid, width, height)).toEqual({ x: 0, y: 1 });
  });

  it("returns null for an empty mask", () => {
    const { grid, width, height } = gridFromAscii(["...", "..."]);
    expect(topmostLeftmostPoint(grid, width, height)).toBeNull();
  });

  it("returns null for degenerate dimensions or a short grid", () => {
    const { grid } = gridFromAscii(["#"]);
    expect(topmostLeftmostPoint(grid, 0, 1)).toBeNull();
    expect(topmostLeftmostPoint(grid, 1, 0)).toBeNull();
    expect(topmostLeftmostPoint(new Uint8Array(2), 4, 4)).toBeNull();
  });
});

describe("hashImageUrl", () => {
  it("is deterministic for the same input", () => {
    const url = "https://example.supabase.co/storage/v1/object/public/rooms/a.jpg";
    expect(hashImageUrl(url)).toBe(hashImageUrl(url));
  });

  it("emits base36 with no sign for hashes that would otherwise be negative", () => {
    expect(hashImageUrl("https://example.com/a.jpg")).toMatch(/^[0-9a-z]+$/);
  });

  it("gives distinct URLs distinct keys", () => {
    expect(hashImageUrl("https://example.com/a.jpg")).not.toBe(
      hashImageUrl("https://example.com/b.jpg")
    );
  });

  it("is case-sensitive, so two casings of one URL differ", () => {
    expect(hashImageUrl("https://example.com/A.jpg")).not.toBe(
      hashImageUrl("https://example.com/a.jpg")
    );
  });

  it("returns a stable value for the empty string", () => {
    expect(hashImageUrl("")).toBe(hashImageUrl(""));
    expect(hashImageUrl("")).toMatch(/^[0-9a-z]+$/);
  });
});