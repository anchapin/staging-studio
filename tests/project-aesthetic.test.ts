import { describe, it, expect } from "vitest";
import {
  resolveRoomAesthetic,
  projectAestheticBadge,
  aestheticOptions,
  AESTHETIC_NOT_SET,
} from "@/lib/project-aesthetic";
import { STAGING_AESTHETICS } from "@/lib/staging-aesthetics";

describe("project aesthetic (#1189)", () => {
  it("every room resolves to the project aesthetic", () => {
    expect(resolveRoomAesthetic({ stagingAesthetic: "Vintage Modern" })).toBe("Vintage Modern");
  });
  it("trims and handles a missing value", () => {
    expect(resolveRoomAesthetic({ stagingAesthetic: "  Coastal Minimal " })).toBe("Coastal Minimal");
    expect(resolveRoomAesthetic({ stagingAesthetic: null })).toBe("");
  });
  it("badge names the project aesthetic", () => {
    expect(projectAestheticBadge("Vintage Modern")).toBe("Project aesthetic: Vintage Modern");
    expect(projectAestheticBadge("")).toBe(`Project aesthetic: ${AESTHETIC_NOT_SET}`);
  });
  it("keeps a non-preset saved value visible in the dropdown", () => {
    const opts = aestheticOptions("Vintage Modern");
    expect(opts[0]).toBe("Vintage Modern");
    expect(opts).toHaveLength(STAGING_AESTHETICS.length + 1);
  });
  it("does not duplicate a preset value", () => {
    expect(aestheticOptions("Warm Transitional")).toEqual([...STAGING_AESTHETICS]);
    expect(aestheticOptions(undefined)).toEqual([...STAGING_AESTHETICS]);
  });
});
