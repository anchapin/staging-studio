import { describe, expect, it } from "vitest";

import {
  hashImageUrl,
  joinRegionLabels,
  maskBounds,
  resolveRegionLabel,
  topmostLeftmostPoint,
} from "@/lib/vision-labels";

/** Builds a grid from rows of '0'/'1' characters. */

describe("hashImageUrl", () => {
  it("produces stable hashes", () => {
    const url = "https://example.com/photo.jpg";
    expect(hashImageUrl(url)).toBe(hashImageUrl(url));
  });

  it("different urls produce different hashes", () => {
    expect(hashImageUrl("https://a.com")).not.toBe(hashImageUrl("https://b.com"));
  });
});

/** Builds a grid from rows of '0'/'1' characters. */
function rows(...lines: string[]): { grid: Uint8Array; width: number; height: number } {
  const height = lines.length;
  const width = lines[0]?.length ?? 0;
  const grid = new Uint8Array(width * height);
  lines.forEach((line, y) => {
    for (let x = 0; x < width; x++) grid[y * width + x] = line[x] === "1" ? 1 : 0;
  });
  return { grid, width, height };
}

describe("joinRegionLabels", () => {
  it("keeps a single unique label singular (a fused pair of chairs stays 'chair')", () => {
    expect(joinRegionLabels(["chair", "chair"])).toBe("chair");
  });

  it("joins two unique labels with 'and'", () => {
    expect(joinRegionLabels(["sofa", "coffee table"])).toBe("sofa and coffee table");
  });

  it("joins three-plus unique labels with commas and a final 'and'", () => {
    expect(joinRegionLabels(["sofa", "coffee table", "lamp"])).toBe(
      "sofa, coffee table, and lamp"
    );
  });

  it("is deterministic: first-seen order, duplicates dropped", () => {
    expect(joinRegionLabels(["lamp", "sofa", "lamp", "coffee table", "sofa"])).toBe(
      "lamp, sofa, and coffee table"
    );
  });

  it("ignores empty and whitespace-only labels", () => {
    expect(joinRegionLabels(["", "  ", "sofa"])).toBe("sofa");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(joinRegionLabels([])).toBe("");
    expect(joinRegionLabels(["", null, undefined])).toBe("");
  });

  it("trims labels before joining", () => {
    expect(joinRegionLabels([" sofa ", "lamp"])).toBe("sofa and lamp");
  });
});

describe("resolveRegionLabel", () => {
  it("prefers the joined vision labels", () => {
    expect(resolveRegionLabel(["sofa", "coffee table"], "furniture")).toBe(
      "sofa and coffee table"
    );
  });

  it("falls back to the concept string when no vision label exists", () => {
    expect(resolveRegionLabel([null, undefined], "sofa")).toBe("sofa");
    expect(resolveRegionLabel([], "sofa")).toBe("sofa");
  });

  it("falls back to the concept when vision labels are empty", () => {
    expect(resolveRegionLabel(["", "  "], "chair")).toBe("chair");
  });
});

describe("maskBounds", () => {
  it("returns the tight bounding box of painted cells", () => {
    const { grid, width, height } = rows(
      "00000",
      "00100",
      "01110",
      "00000"
    );
    expect(maskBounds(grid, width, height)).toEqual({ minX: 1, minY: 1, maxX: 3, maxY: 2 });
  });

  it("returns null for an empty grid or malformed geometry", () => {
    expect(maskBounds(new Uint8Array(4), 2, 2)).toBeNull();
    expect(maskBounds(new Uint8Array(4), 0, 2)).toBeNull();
    expect(maskBounds(new Uint8Array(3), 2, 2)).toBeNull();
  });
});

describe("topmostLeftmostPoint", () => {
  it("returns the first painted cell scanning top-to-bottom, left-to-right", () => {
    const { grid, width, height } = rows(
      "00000",
      "01011",
      "11011",
      "00000"
    );
    // Topmost painted row is row 1; leftmost painted cell in it is x=1.
    expect(topmostLeftmostPoint(grid, width, height)).toEqual({ x: 1, y: 1 });
  });

  it("returns null for an empty grid", () => {
    expect(topmostLeftmostPoint(new Uint8Array(4), 2, 2)).toBeNull();
  });
});
