import type { CSSProperties } from "react";

/**
 * Issue #615: precision slider fill math for the Atelier Canvas spec sliders.
 *
 * `.atelier-slider` tracks render the active fill (charred walnut #181716) as
 * a linear-gradient stop driven by the `--atelier-fill` custom property, and
 * `.atelier-slider-tooltip` positions its numeric tooltip at the same value.
 * Firefox fills its track natively via `::-moz-range-progress`, but the custom
 * property is still applied so every call site behaves identically.
 */

/** Clamped 0–100 percentage of the track the current value fills. */
export function sliderFillPercent(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0;
  }
  if (max <= min) {
    return 0;
  }
  const percent = ((value - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, percent));
}

/** Inline style carrying `--atelier-fill` for an `.atelier-slider` input. */
export function sliderFillStyle(value: number, min: number, max: number): CSSProperties {
  return { "--atelier-fill": `${sliderFillPercent(value, min, max)}%` } as CSSProperties;
}
