import { describe, expect, it } from "vitest";
import {
  EMPTY_HEADING_HINT,
  EMPTY_HEADING_TITLE,
  inspectorHeading,
} from "@/lib/inspector-heading";

describe("inspectorHeading (issue #1195)", () => {
  it("shows the whole-room preset on the Entire room tab", () => {
    expect(
      inspectorHeading({ effectiveTab: "entire", hasPaintedMask: false }).title,
    ).toBe("Editing: Whole room");
  });

  it("names a single detected object, capitalised", () => {
    const h = inspectorHeading({
      effectiveTab: "detect",
      batchSelections: [{ conceptLabel: "sofa" }],
      hasPaintedMask: false,
    });
    expect(h.title).toBe("Editing: Sofa");
    expect(h.hint).toBeNull();
    expect(h.hasSelection).toBe(true);
  });

  it("falls back to '1 area' when the region has no concept label", () => {
    expect(
      inspectorHeading({
        effectiveTab: "detect",
        batchSelections: [{}],
        hasPaintedMask: false,
      }).title,
    ).toBe("Editing: 1 area");
  });

  it("counts multiple regions", () => {
    expect(
      inspectorHeading({
        effectiveTab: "detect",
        batchSelections: [
          { conceptLabel: "sofa" },
          { conceptLabel: "rug" },
          { conceptLabel: "lamp" },
        ],
        hasPaintedMask: false,
      }).title,
    ).toBe("Editing: 3 areas");
  });

  it("describes a hand-brushed mask on the manual tab", () => {
    expect(
      inspectorHeading({ effectiveTab: "manual", hasPaintedMask: true }).title,
    ).toBe("Editing: Brushed area");
  });

  it("prompts for a selection when nothing is selected", () => {
    for (const effectiveTab of ["detect", "manual"]) {
      const h = inspectorHeading({
        effectiveTab,
        batchSelections: [],
        hasPaintedMask: false,
      });
      expect(h.title).toBe(EMPTY_HEADING_TITLE);
      expect(h.hint).toBe(EMPTY_HEADING_HINT);
      expect(h.hasSelection).toBe(false);
    }
  });

  it("never uses model jargon", () => {
    const cases = [
      inspectorHeading({ effectiveTab: "entire", hasPaintedMask: false }),
      inspectorHeading({ effectiveTab: "manual", hasPaintedMask: true }),
      inspectorHeading({ effectiveTab: "detect", hasPaintedMask: false }),
    ];
    for (const h of cases) expect(h.title).not.toMatch(/inpaint|zone/i);
  });
});
