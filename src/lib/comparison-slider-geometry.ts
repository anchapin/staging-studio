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
 * Deliberately minimal — issue #708 tracks fuller geometry extraction;
 * extend this module rather than duplicating it.
 *
 * Distinct from lib/split-comparison-canvas.ts (issue #618 studio canvas,
 * whose clamps fall back to a 42% initial split): this component has no
 * fallback position, so degenerate rect math is left to the caller.
 */

export const MIN_SLIDER_PERCENT = 0;
export const MAX_SLIDER_PERCENT = 100;

/** Percentage moved per ArrowLeft / ArrowRight keypress. */
export const SLIDER_KEYBOARD_STEP = 5;

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
