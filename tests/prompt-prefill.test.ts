import { describe, expect, it } from "vitest";
import { buildPrefill } from "@/lib/prompt-prefill";

/**
 * Issue #230: the client-side concept pre-fill builder, pinned 1:1. The
 * exact byte shape of the seed matters — it is user-visible editable text
 * shown in per-object batch rows and the single-object directives field.
 */
describe("buildPrefill", () => {
  it("names the concept as an incomplete replace sentence", () => {
    expect(buildPrefill("accent chair")).toBe("Replace the accent chair with ");
    expect(buildPrefill("sofa")).toBe("Replace the sofa with ");
  });

  it("returns an empty string for missing labels", () => {
    expect(buildPrefill(undefined)).toBe("");
    expect(buildPrefill(null)).toBe("");
    expect(buildPrefill("")).toBe("");
  });

  it("treats a blank label as no label", () => {
    expect(buildPrefill("   ")).toBe("");
  });

  it("trims surrounding whitespace from the label", () => {
    expect(buildPrefill("  rug  ")).toBe("Replace the rug with ");
  });

  it("preserves multi-word labels verbatim", () => {
    expect(buildPrefill("mid-century armchair")).toBe(
      "Replace the mid-century armchair with "
    );
  });
});
