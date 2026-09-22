import { describe, expect, it } from "vitest";

import {
  ENGAGEMENT_TIERS,
  formatEngagementPrice,
  type EngagementTier,
} from "@/lib/engagement-tiers";

describe("ENGAGEMENT_TIERS", () => {
  it("has exactly 3 tiers", () => {
    expect(ENGAGEMENT_TIERS).toHaveLength(3);
  });

  it("has correct tier IDs in order", () => {
    expect(ENGAGEMENT_TIERS.map((t) => t.id)).toEqual([
      "essential-virtual",
      "full-immersive",
      "enterprise",
    ]);
  });

  it("has Essential Virtual with correct price", () => {
    const tier = ENGAGEMENT_TIERS.find((t) => t.id === "essential-virtual")!;
    expect(tier.name).toBe("Essential Virtual");
    expect(tier.price).toBe(299);
    expect(tier.recommended).toBe(false);
    expect(tier.includes).toContain("Virtual declutter consultation");
  });

  it("has Full Immersive as the recommended tier", () => {
    const tier = ENGAGEMENT_TIERS.find((t) => t.id === "full-immersive")!;
    expect(tier.name).toBe("Full Immersive");
    expect(tier.price).toBe(1199);
    expect(tier.recommended).toBe(true);
    expect(tier.includes).toContain("Unlimited revision rounds");
  });

  it("has Enterprise with null price (Custom Quote)", () => {
    const tier = ENGAGEMENT_TIERS.find((t) => t.id === "enterprise")!;
    expect(tier.name).toBe("Enterprise / Portfolio");
    expect(tier.price).toBeNull();
    expect(tier.recommended).toBe(false);
    expect(tier.includes).toContain("Unlimited property portfolio");
  });

  it("has a CTA for each tier", () => {
    for (const tier of ENGAGEMENT_TIERS) {
      expect(tier.cta).toBeTruthy();
      expect(typeof tier.cta).toBe("string");
    }
  });

  it("has non-empty includes array for each tier", () => {
    for (const tier of ENGAGEMENT_TIERS) {
      expect(tier.includes.length).toBeGreaterThan(0);
    }
  });
});

describe("formatEngagementPrice", () => {
  it("formats a number as USD currency", () => {
    expect(formatEngagementPrice(299)).toBe("$299");
    expect(formatEngagementPrice(1199)).toBe("$1,199");
    expect(formatEngagementPrice(45000)).toBe("$45,000");
  });

  it("returns 'Custom Quote' for null price", () => {
    expect(formatEngagementPrice(null)).toBe("Custom Quote");
  });
});
