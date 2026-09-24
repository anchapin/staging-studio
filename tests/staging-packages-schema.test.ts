import { describe, expect, it } from "vitest";

import {
  STAGING_PACKAGES,
  formatPrice,
  getStagingPackage,
} from "@/lib/staging-packages-schema";

describe("STAGING_PACKAGES", () => {
  it("has exactly 3 packages", () => {
    expect(STAGING_PACKAGES).toHaveLength(3);
  });

  it("has unique ids in tier order", () => {
    expect(STAGING_PACKAGES.map((p) => p.id)).toEqual([
      "essential",
      "premium",
      "turnkey",
    ]);
  });

  it("prices ascend with the tier", () => {
    const prices = STAGING_PACKAGES.map((p) => p.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("has exactly one recommended package", () => {
    expect(STAGING_PACKAGES.filter((p) => p.recommended)).toHaveLength(1);
  });
});

describe("getStagingPackage", () => {
  it("returns the Essential package", () => {
    expect(getStagingPackage("essential")).toEqual({
      id: "essential",
      name: "Essential",
      rooms: 2,
      price: 12000,
      includes: ["Living", "Dining"],
      recommended: false,
    });
  });

  it("returns the Premium package (the recommended tier)", () => {
    expect(getStagingPackage("premium")).toEqual({
      id: "premium",
      name: "Premium",
      rooms: 4,
      price: 28000,
      includes: ["Living", "Dining", "Master", "Guest"],
      recommended: true,
    });
  });

  it("returns the Turnkey package (rooms: \"All\")", () => {
    expect(getStagingPackage("turnkey")).toEqual({
      id: "turnkey",
      name: "Turnkey",
      rooms: "All",
      price: 45000,
      includes: ["Full delivery", "Pickup"],
      recommended: false,
    });
  });

  it("returns null for unknown ids", () => {
    expect(getStagingPackage("ultimate")).toBeNull();
    expect(getStagingPackage("")).toBeNull();
  });

  it("is case-sensitive: \"Essential\" is not a known id", () => {
    expect(getStagingPackage("Essential")).toBeNull();
  });
});

describe("formatPrice", () => {
  it("formats the three package prices as whole-dollar USD", () => {
    expect(formatPrice(12000)).toBe("$12,000");
    expect(formatPrice(28000)).toBe("$28,000");
    expect(formatPrice(45000)).toBe("$45,000");
  });

  it("formats edge values without separators", () => {
    expect(formatPrice(0)).toBe("$0");
    expect(formatPrice(999)).toBe("$999");
  });

  it("rounds fractional dollars away from zero (half-expand)", () => {
    expect(formatPrice(1234.5)).toBe("$1,235");
    expect(formatPrice(1234.4)).toBe("$1,234");
  });

  it("scales to seven-digit quotes", () => {
    expect(formatPrice(1234567)).toBe("$1,234,567");
  });
});
