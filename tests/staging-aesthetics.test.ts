import { describe, expect, it } from "vitest";

import { STAGING_AESTHETICS } from "@/lib/staging-aesthetics";

describe("STAGING_AESTHETICS", () => {
  it("has exactly 5 aesthetics", () => {
    expect(STAGING_AESTHETICS).toHaveLength(5);
  });

  it("entries are unique", () => {
    expect(new Set(STAGING_AESTHETICS).size).toBe(STAGING_AESTHETICS.length);
  });

  it("entries are non-empty strings", () => {
    for (const aesthetic of STAGING_AESTHETICS) {
      expect(aesthetic.trim().length).toBeGreaterThan(0);
    }
  });

  it("matches the pinned snapshot (feeds the directives bar and AI prompts)", () => {
    expect(STAGING_AESTHETICS).toMatchInlineSnapshot(`
      [
        "Organic Modern Luxury",
        "Warm Transitional",
        "Coastal Minimal",
        "Urban Industrial",
        "Classic Elegant",
      ]
    `);
  });
});
