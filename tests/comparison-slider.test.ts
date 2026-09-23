import { describe, expect, it } from "vitest";
import {
  MAX_SLIDER_PERCENT,
  MIN_SLIDER_PERCENT,
  SLIDER_KEYBOARD_STEP,
  clampSliderPercent,
  nudgeSliderPercent,
  sliderPercentFromClientX,
} from "@/lib/comparison-slider-geometry";

/**
 * Issue #623 / #693: before/after comparison slider geometry.
 *
 * Pins the pure slider math in lib/comparison-slider-geometry.ts 1:1 —
 * the clientX→percent clamp and keyboard ±5 nudge that drive the
 * clip-path split, handle position, and mobile progress bar in
 * src/components/canvas/comparison-slider.tsx. (Replaces the pre-#693
 * tautology test that asserted its own inline class-string literals,
 * including hard-coded hex tokens that duplicated color-tokens.ts.)
 */

describe("clampSliderPercent", () => {
  it("passes through in-range values unchanged", () => {
    expect(clampSliderPercent(0)).toBe(0);
    expect(clampSliderPercent(50)).toBe(50);
    expect(clampSliderPercent(100)).toBe(100);
    expect(clampSliderPercent(42.37)).toBe(42.37);
  });

  it("clamps below-range values up to MIN_SLIDER_PERCENT", () => {
    expect(clampSliderPercent(-0.001)).toBe(MIN_SLIDER_PERCENT);
    expect(clampSliderPercent(-50)).toBe(MIN_SLIDER_PERCENT);
  });

  it("clamps above-range values down to MAX_SLIDER_PERCENT", () => {
    expect(clampSliderPercent(100.001)).toBe(MAX_SLIDER_PERCENT);
    expect(clampSliderPercent(9999)).toBe(MAX_SLIDER_PERCENT);
  });
});

describe("sliderPercentFromClientX — pointer to percent", () => {
  it("maps a clientX at the rect's left edge to 0%", () => {
    expect(sliderPercentFromClientX(100, { left: 100, width: 400 })).toBe(0);
  });

  it("maps a clientX at the rect's right edge to 100%", () => {
    expect(sliderPercentFromClientX(500, { left: 100, width: 400 })).toBe(100);
  });

  it("maps the exact center of the rect to 50%", () => {
    expect(sliderPercentFromClientX(300, { left: 100, width: 400 })).toBe(50);
  });

  it("accounts for a nonzero rect.left offset", () => {
    // 40% across a 250px-wide rect starting at x=37
    expect(sliderPercentFromClientX(37 + 100, { left: 37, width: 250 })).toBe(40);
  });

  it("handles fractional rect widths without losing precision", () => {
    const rect = { left: 12.3, width: 333.7 };
    // midpoint of a fractional rect still lands exactly at 50
    expect(sliderPercentFromClientX(rect.left + rect.width / 2, rect)).toBe(50);
    // quarter point lands at 25 within float tolerance
    expect(sliderPercentFromClientX(rect.left + rect.width / 4, rect)).toBeCloseTo(25, 10);
  });

  it("clamps pointers dragged past either edge", () => {
    const rect = { left: 0, width: 200 };
    expect(sliderPercentFromClientX(-40, rect)).toBe(MIN_SLIDER_PERCENT);
    expect(sliderPercentFromClientX(9999, rect)).toBe(MAX_SLIDER_PERCENT);
  });
});

describe("nudgeSliderPercent — keyboard ±5 step", () => {
  it("steps right by SLIDER_KEYBOARD_STEP", () => {
    expect(nudgeSliderPercent(20, 1)).toBe(20 + SLIDER_KEYBOARD_STEP);
  });

  it("steps left by SLIDER_KEYBOARD_STEP", () => {
    expect(nudgeSliderPercent(20, -1)).toBe(20 - SLIDER_KEYBOARD_STEP);
  });

  it("accumulates across the 100 boundary without overshooting", () => {
    let p = 97;
    p = nudgeSliderPercent(p, 1); // 102 → 100
    expect(p).toBe(MAX_SLIDER_PERCENT);
    p = nudgeSliderPercent(p, 1); // pinned at 100
    expect(p).toBe(MAX_SLIDER_PERCENT);
  });

  it("accumulates across the 0 boundary without undershooting", () => {
    let p = 3;
    p = nudgeSliderPercent(p, -1); // -2 → 0
    expect(p).toBe(MIN_SLIDER_PERCENT);
    p = nudgeSliderPercent(p, -1); // pinned at 0
    expect(p).toBe(MIN_SLIDER_PERCENT);
  });

  it("recovers from a pinned edge in the opposite direction", () => {
    expect(nudgeSliderPercent(MAX_SLIDER_PERCENT, -1)).toBe(100 - SLIDER_KEYBOARD_STEP);
    expect(nudgeSliderPercent(MIN_SLIDER_PERCENT, 1)).toBe(SLIDER_KEYBOARD_STEP);
  });
});

describe("slider geometry constants", () => {
  it("exports the spec range and keyboard step", () => {
    expect(MIN_SLIDER_PERCENT).toBe(0);
    expect(MAX_SLIDER_PERCENT).toBe(100);
    expect(SLIDER_KEYBOARD_STEP).toBe(5);
  });
});
