/**
 * Pure slider geometry for the before/after comparison slider (issue #623).
 *
 * The report/lookbook ComparisonSlider
 * (src/components/canvas/comparison-slider.tsx) converts pointer clientX
 * coordinates and keyboard arrow nudges into a 0–100 percentage that
 * drives the clip-path split, the handle position, and the mobile
 * progress bar. The math lives here so it can be pinned 1:1 by
 * tests/comparison-slider.test.ts (repo pattern: pure logic in
 * `src/lib/<name>.ts`, never test components directly).
 *
 * Issue #693 extracted the pointer clamp and keyboard nudge; issue #708
 * completed the extraction with the clip-path split and the passive
 * reveal target. All position geometry for this component lives here.
 *
 * Distinct from lib/split-comparison-canvas.ts (issue #618 studio canvas,
 * whose clamps fall back to a 42% initial split): this component has no
 * fallback position, so degenerate rect math is left to the caller.
 */

export const MIN_SLIDER_PERCENT = 0;
export const MAX_SLIDER_PERCENT = 100;

/** Percentage moved per ArrowLeft / ArrowRight keypress. */
export const SLIDER_KEYBOARD_STEP = 5;

/**
 * Position the report-mode passive reveal animation lands on (issue #623:
 * the 0 → 50% sweep over 800ms that advertises the comparison on first
 * load). Exact center, so neither side starts favored.
 */
export const SLIDER_REVEAL_TARGET_PERCENT = 50;

/** Clamp a slider percentage to the valid 0–100 range. */
export function clampSliderPercent(value: number): number {
  return Math.max(MIN_SLIDER_PERCENT, Math.min(MAX_SLIDER_PERCENT, value));
}

/**
 * Convert a pointer's clientX into a slider percentage given the slider
 * container's bounding rect. Coordinates outside the rect clamp to the
 * nearest edge (dragging past either side pins the split at 0% / 100%).
 */
export function sliderPercentFromClientX(
  clientX: number,
  rect: { left: number; width: number }
): number {
  return clampSliderPercent(((clientX - rect.left) / rect.width) * 100);
}

/**
 * Step the slider position by ±SLIDER_KEYBOARD_STEP (keyboard nudge),
 * clamped to 0–100 so repeated presses pile up at the edges instead of
 * overshooting.
 */
export function nudgeSliderPercent(percent: number, direction: 1 | -1): number {
  return clampSliderPercent(percent + direction * SLIDER_KEYBOARD_STEP);
}

/**
 * clip-path that reveals the after (top-layer) image up to `percent`,
 * clipping from the right edge: at 0% the after image is fully hidden,
 * at 100% fully shown. `percent` is clamped so a stray out-of-range
 * value can never produce a negative (expanding) inset. Inverse of the
 * handle position: the visible width equals the slider percentage.
 */
export function sliderClipPath(percent: number): string {
  return `inset(0 ${MAX_SLIDER_PERCENT - clampSliderPercent(percent)}% 0 0)`;
}
