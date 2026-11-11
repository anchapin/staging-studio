/**
 * Pure sample-size math for the scene-conservation measurement layer
 * (staging-studio #1513).
 *
 * Extracted from `src/lib/edit-conservation-measure.ts` so the math can be
 * pinned by `tests/edit-conservation-geometry.test.ts` without pulling in
 * the browser-only `Image` / `canvas` glue. The function takes two raw
 * numbers and returns the two sampled dimensions; nothing else.
 *
 * The contract preserved from the measurement layer:
 * - The sampled width is always `CONSERVATION_SAMPLE_WIDTH` (256px) —
 *   the width is the fixed axis, the height follows the source aspect
 *   ratio.
 * - The sampled height is the source aspect ratio applied to the sampled
 *   width, rounded to the nearest integer.
 * - The height is clamped to a minimum of 1 (a very wide source would
 *   otherwise round to 0) and to a maximum of
 *   `CONSERVATION_MAX_SAMPLE_HEIGHT` (1024px) so an absurdly tall
 *   panorama cannot blow up the pixel budget.
 *
 * @param naturalWidth The natural pixel width of the source image.
 * @param naturalHeight The natural pixel height of the source image.
 * @returns A `{ width, height }` pair; width is always
 *   `CONSERVATION_SAMPLE_WIDTH`, height is an integer in
 *   `[1, CONSERVATION_MAX_SAMPLE_HEIGHT]`.
 */

/**
 * Width (px) the frames are sampled at. Small enough to keep the pixel
 * pass cheap (65k pixels), large enough that a 4×4 grid still sees real
 * structure.
 */
export const CONSERVATION_SAMPLE_WIDTH = 256;

/** Upper bound on the sampled height (guards against absurd aspect ratios). */
export const CONSERVATION_MAX_SAMPLE_HEIGHT = 1024;

export interface ConservationSampleSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Computes the sample dimensions used when measuring a scene-conservation
 * frame.
 *
 * @param naturalWidth The natural pixel width of the source image.
 * @param naturalHeight The natural pixel height of the source image.
 */
export function computeConservationSampleSize(
  naturalWidth: number,
  naturalHeight: number,
): ConservationSampleSize {
  const width = CONSERVATION_SAMPLE_WIDTH;
  const height = Math.min(
    CONSERVATION_MAX_SAMPLE_HEIGHT,
    Math.max(1, Math.round((width * naturalHeight) / naturalWidth)),
  );
  return { width, height };
}
