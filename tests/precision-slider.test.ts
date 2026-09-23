import { describe, expect, it } from "vitest";

import { sliderFillPercent, sliderFillStyle } from "@/lib/precision-slider";

/**
 * Issue #615: Precision custom range sliders.
 *
 * The active-fill track gradient and the hover tooltip both position off the
 * `--atelier-fill` custom property, so the fill math must be pinned:
 *
 * 1. Percentage maps value linearly across the min→max span.
 * 2. Out-of-range values clamp to 0 or 100.
 * 3. Degenerate ranges (min >= max) and non-finite inputs resolve to 0 so the
 *    track stays warm taupe instead of producing an invalid gradient stop.
 * 4. sliderFillStyle serializes the percentage into the CSS custom property.
 */
describe("sliderFillPercent", () => {
  it("maps the midpoint to 50%", () => {
    expect(sliderFillPercent(50, 0, 100)).toBe(50);
  });

  it("maps the minimum to 0% and the maximum to 100%", () => {
    expect(sliderFillPercent(0, 0, 100)).toBe(0);
    expect(sliderFillPercent(100, 0, 100)).toBe(100);
  });

  it("maps values across a non-zero-based span", () => {
    expect(sliderFillPercent(1, 1, 5)).toBe(0);
    expect(sliderFillPercent(3, 1, 5)).toBe(50);
    expect(sliderFillPercent(5, 1, 5)).toBe(100);
  });

  it("supports fractional values", () => {
    expect(sliderFillPercent(7.5, 1, 20)).toBeCloseTo(34.2105, 4);
  });

  it("clamps values below min to 0%", () => {
    expect(sliderFillPercent(-12, 0, 100)).toBe(0);
  });

  it("clamps values above max to 100%", () => {
    expect(sliderFillPercent(140, 0, 100)).toBe(100);
  });

  it("returns 0 for a degenerate range where min equals max", () => {
    expect(sliderFillPercent(42, 42, 42)).toBe(0);
  });

  it("returns 0 for an inverted range", () => {
    expect(sliderFillPercent(10, 100, 0)).toBe(0);
  });

  it("returns 0 for non-finite inputs", () => {
    expect(sliderFillPercent(Number.NaN, 0, 100)).toBe(0);
    expect(sliderFillPercent(50, Number.NaN, 100)).toBe(0);
    expect(sliderFillPercent(50, 0, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("sliderFillStyle", () => {
  it("serializes the fill percentage into the --atelier-fill custom property", () => {
    expect(sliderFillStyle(35, 0, 50)).toEqual({ "--atelier-fill": "70%" });
  });

  it("includes the % unit for a full-span value", () => {
    expect(sliderFillStyle(100, 0, 100)).toEqual({ "--atelier-fill": "100%" });
  });

  it("degrades degenerate ranges to 0%", () => {
    expect(sliderFillStyle(Number.NaN, 0, 100)).toEqual({ "--atelier-fill": "0%" });
  });
});
