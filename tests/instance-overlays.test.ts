import { describe, expect, it } from "vitest";
import {
  buildInstanceOverlays,
  buildSelectionMarkers,
  type OverlayInstanceGrid,
} from "@/lib/instance-overlays";
import type { BatchSelection } from "@/lib/multi-select-batch";

/** 4x4 grid with a single set pixel at (x, y). */
function gridWithPixel(
  width: number,
  height: number,
  x: number,
  y: number
): OverlayInstanceGrid {
  const grid = new Uint8Array(width * height);
  grid[y * width + x] = 1;
  return { grid, width, height };
}

function selection(
  id: string,
  memberInstanceIndices: number[] | undefined
): BatchSelection {
  return {
    id,
    point: { x: 0, y: 0 },
    maskDataUrl: "data:image/png;base64,mask",
    ...(memberInstanceIndices !== undefined
      ? {
          conceptLabel: "sofa",
          memberInstanceIndices,
        }
      : {}),
  };
}

describe("buildInstanceOverlays (issue #691 extraction)", () => {
  const result = {
    concept: "sofa",
    maskDataUrls: ["data:0", "data:1", "data:2"],
  };

  it("skips undecodable (null) instance slots to keep response indices stable", () => {
    const instances = [gridWithPixel(4, 4, 0, 0), null, gridWithPixel(4, 4, 1, 1)];
    const overlays = buildInstanceOverlays(result, instances, [], []);
    expect(overlays.map((o) => o.id)).toEqual(["sofa:0", "sofa:2"]);
    expect(overlays.map((o) => o.maskDataUrl)).toEqual(["data:0", "data:2"]);
    expect(overlays.map((o) => o.rank)).toEqual([0, 2]);
  });

  it("marks selected instances and leaves detected-only ones unselected", () => {
    const instances = [gridWithPixel(4, 4, 0, 0), gridWithPixel(4, 4, 1, 1)];
    const overlays = buildInstanceOverlays(result, instances, [], [1]);
    expect(overlays.find((o) => o.rank === 0)?.selected).toBe(false);
    expect(overlays.find((o) => o.rank === 1)?.selected).toBe(true);
  });

  it("carries the region position as colorIndex for selected region members only", () => {
    const instances = [gridWithPixel(4, 4, 0, 0), gridWithPixel(4, 4, 1, 1)];
    const selections = [selection("r0", [0, 1])];
    // Both members selected: both tint with region slot 0.
    const both = buildInstanceOverlays(result, instances, selections, [0, 1]);
    expect(both.find((o) => o.rank === 0)?.colorIndex).toBe(0);
    expect(both.find((o) => o.rank === 1)?.colorIndex).toBe(0);
    // Only instance 1 selected: selected member carries the region slot,
    // the unselected member has NO colorIndex (rank color is used).
    const one = buildInstanceOverlays(result, instances, selections, [1]);
    expect(one.find((o) => o.rank === 0)?.colorIndex).toBeUndefined();
    expect(one.find((o) => o.rank === 1)?.colorIndex).toBe(0);
  });

  it("uses each region's own position as the palette slot", () => {
    const instances = [
      gridWithPixel(4, 4, 0, 0),
      gridWithPixel(4, 4, 1, 1),
      gridWithPixel(4, 4, 2, 2),
    ];
    const selections = [selection("r0", [0]), selection("r1", [1]), selection("r2", [2])];
    const overlays = buildInstanceOverlays(result, instances, selections, [0, 1, 2]);
    expect(overlays.map((o) => o.colorIndex)).toEqual([0, 1, 2]);
  });

  it("emits no colorIndex for selections without member indices", () => {
    const instances = [gridWithPixel(4, 4, 0, 0)];
    const overlays = buildInstanceOverlays(
      result,
      instances,
      [selection("legacy", undefined)],
      [0]
    );
    expect(overlays).toHaveLength(1);
    expect(overlays[0].selected).toBe(true);
    expect(overlays[0].colorIndex).toBeUndefined();
  });
});

describe("buildSelectionMarkers (issue #691 extraction)", () => {
  it("anchors each marker at the union's topmost-leftmost member pixel", () => {
    // Member 0 has its pixel at (3, 1); member 1 at (0, 2). The union's
    // topmost pixel is (3, 1) — y wins over x.
    const instances = [gridWithPixel(4, 4, 3, 1), gridWithPixel(4, 4, 0, 2)];
    const markers = buildSelectionMarkers(
      [selection("r0", [0, 1])],
      instances,
      { width: 8, height: 8 }
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ id: "r0", index: 1, x: 3 * 2, y: 1 * 2 });
  });

  it("breaks ties on x when member pixels share the topmost row", () => {
    const instances = [gridWithPixel(4, 4, 2, 1), gridWithPixel(4, 4, 0, 1)];
    const markers = buildSelectionMarkers(
      [selection("r0", [0, 1])],
      instances,
      { width: 4, height: 4 }
    );
    expect(markers[0]).toMatchObject({ x: 0, y: 1 });
  });

  it("numbers markers by 1-based position across regions", () => {
    const instances = [gridWithPixel(4, 4, 0, 0), gridWithPixel(4, 4, 1, 1)];
    const markers = buildSelectionMarkers(
      [selection("r0", [0]), selection("r1", [1])],
      instances,
      { width: 4, height: 4 }
    );
    expect(markers.map((m) => m.index)).toEqual([1, 2]);
  });

  it("scales grid coordinates by the FIRST decoded instance's geometry", () => {
    // First instance is 2x2 (scale 2x); second is 4x4 but only the first
    // sets the scale factors, mirroring the extracted editor behavior.
    const instances = [gridWithPixel(2, 2, 1, 0), gridWithPixel(4, 4, 3, 3)];
    const markers = buildSelectionMarkers(
      [selection("r0", [1])],
      instances,
      { width: 4, height: 4 }
    );
    expect(markers[0]).toMatchObject({ x: 3 * (4 / 2), y: 3 * (4 / 2) });
  });

  it("falls back to 1:1 natural dims when the first instance slot is null", () => {
    const instances = [null, gridWithPixel(4, 4, 2, 2)];
    const markers = buildSelectionMarkers(
      [selection("r0", [1])],
      instances,
      { width: 4, height: 4 }
    );
    expect(markers[0]).toMatchObject({ x: 2, y: 2 });
  });

  it("drops regions whose members have no decodable pixels", () => {
    const empty: OverlayInstanceGrid = {
      grid: new Uint8Array(16),
      width: 4,
      height: 4,
    };
    const markers = buildSelectionMarkers(
      [selection("r0", [0]), selection("r1", [1])],
      [empty, gridWithPixel(4, 4, 1, 1)],
      { width: 4, height: 4 }
    );
    expect(markers.map((m) => m.id)).toEqual(["r1"]);
  });
});
