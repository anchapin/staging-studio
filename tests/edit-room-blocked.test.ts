import { describe, expect, it } from "vitest";

import {
  resolveStageBlockedReason,
} from "@/lib/edit-room-blocked";

// Pin the resolveStageBlockedReason resolver from issue #1337's acceptance criteria.
// Eight cases required by the issue: every blocked branch + happy path.
describe("resolveStageBlockedReason", () => {
  const happy = {
    scope: "whole-room" as const,
    viewing: "original" as const,
    hasMask: false,
    selectedCount: 0,
    hasDirections: true,
  };

  it("returns null when all required inputs are present (happy path)", () => {
    expect(resolveStageBlockedReason(happy)).toBeNull();
  });

  it("blocks whole-room staging when viewing is a variant (whole-room starts from the original)", () => {
    expect(
      resolveStageBlockedReason({
        scope: "whole-room",
        viewing: "A",
        hasMask: false,
        selectedCount: 0,
        hasDirections: true,
      })
    ).toBe("Whole-room staging starts from the original photo.");
  });

  it("blocks objects staging when viewing is the original (no objects to pick)", () => {
    expect(
      resolveStageBlockedReason({
        scope: "objects",
        viewing: "original",
        hasMask: false,
        selectedCount: 0,
        hasDirections: true,
      })
    ).toBe("The original photo is empty — there are no objects to pick.");
  });

  it("blocks objects staging when nothing is selected", () => {
    expect(
      resolveStageBlockedReason({
        scope: "objects",
        viewing: "A",
        hasMask: false,
        selectedCount: 0,
        hasDirections: true,
      })
    ).toBe("Pick at least one object on the photo.");
  });

  it("blocks paint staging when there is no mask", () => {
    expect(
      resolveStageBlockedReason({
        scope: "paint",
        viewing: "original",
        hasMask: false,
        selectedCount: 0,
        hasDirections: true,
      })
    ).toBe("Paint over the area you want to change.");
  });

  it("blocks every scope when directions are empty (final guard)", () => {
    // whole-room + original + no mask + no selection + no directions
    expect(
      resolveStageBlockedReason({
        scope: "whole-room",
        viewing: "original",
        hasMask: false,
        selectedCount: 0,
        hasDirections: false,
      })
    ).toBe("Add directions so the AI knows what to stage.");
    // objects + A + 1 selected + no directions
    expect(
      resolveStageBlockedReason({
        scope: "objects",
        viewing: "A",
        hasMask: false,
        selectedCount: 1,
        hasDirections: false,
      })
    ).toBe("Add directions so the AI knows what to stage.");
    // paint + original + has mask + no directions
    expect(
      resolveStageBlockedReason({
        scope: "paint",
        viewing: "original",
        hasMask: true,
        selectedCount: 0,
        hasDirections: false,
      })
    ).toBe("Add directions so the AI knows what to stage.");
  });

  it("prioritizes the scope-specific reason over the directions guard", () => {
    // Both blocked; the scope-specific reason wins (it's the first guard that
    // shapes the run, not the universal "directions missing" message).
    expect(
      resolveStageBlockedReason({
        scope: "whole-room",
        viewing: "A",
        hasMask: false,
        selectedCount: 0,
        hasDirections: false,
      })
    ).toBe("Whole-room staging starts from the original photo.");
  });

  it("accepts the objects case with at least one selected object and directions", () => {
    expect(
      resolveStageBlockedReason({
        scope: "objects",
        viewing: "A",
        hasMask: false,
        selectedCount: 2,
        hasDirections: true,
      })
    ).toBeNull();
  });

  it("accepts the paint case with a mask and directions", () => {
    expect(
      resolveStageBlockedReason({
        scope: "paint",
        viewing: "A",
        hasMask: true,
        selectedCount: 0,
        hasDirections: true,
      })
    ).toBeNull();
  });
});