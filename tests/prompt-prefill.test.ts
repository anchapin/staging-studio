import { describe, expect, it } from "vitest";

import { buildPrefill } from "@/lib/prompt-prefill";

describe("buildPrefill", () => {
  it("returns empty string when concept is null", () => {
    expect(buildPrefill(null)).toBe("");
  });

  it("returns empty string when concept is undefined", () => {
    expect(buildPrefill(undefined)).toBe("");
  });

  it("returns empty string when concept is an empty string", () => {
    expect(buildPrefill("")).toBe("");
  });

  it("returns empty string when concept is only whitespace", () => {
    expect(buildPrefill("   ")).toBe("");
    expect(buildPrefill("\t")).toBe("");
    expect(buildPrefill("\n")).toBe("");
  });

  it("returns prefill for a single-word concept", () => {
    expect(buildPrefill("chair")).toBe("Replace the chair with ");
  });

  it("returns prefill for a multi-word concept", () => {
    expect(buildPrefill("accent chair")).toBe("Replace the accent chair with ");
  });

  it("returns prefill for a concept with extra whitespace (trimmed)", () => {
    expect(buildPrefill("  sofa  ")).toBe("Replace the sofa with ");
  });

  it("returns prefill for a short single-character concept", () => {
    expect(buildPrefill("a")).toBe("Replace the a with ");
  });

  it("capitalisation is preserved as provided", () => {
    expect(buildPrefill("Modern")).toBe("Replace the Modern with ");
    expect(buildPrefill("RUG")).toBe("Replace the RUG with ");
    expect(buildPrefill("Farmhouse")).toBe("Replace the Farmhouse with ");
  });

  it("prefill sentence structure is correct", () => {
    const result = buildPrefill("nightstand");
    expect(result).toMatch(/^Replace the .+ with $/);
    expect(result.endsWith(" with ")).toBe(true);
    expect(result.startsWith("Replace the ")).toBe(true);
  });

  it("empty string concept matches the behavior of positional 'Object N' rows", () => {
    // Verifies the documented contract: blank/label-less rows start empty
    expect(buildPrefill("")).toBe("");
    expect(buildPrefill(null)).toBe("");
    expect(buildPrefill(undefined)).toBe("");
  });
});
