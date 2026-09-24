/**
 * Mask coverage helpers for the staging editor's inpaint mask.
 *
 * The mask uses region-replacement semantics for fal.ai FLUX.1 Fill: white
 * pixels are regenerated, black pixels are preserved. New stagers often
 * outline objects expecting selection semantics, which leaves the object's
 * interior preserved and produces confusing "nothing changed" (or
 * ring-artifact) results. These helpers classify mask pixels and detect
 * suspiciously tiny coverage so the UI can nudge stagers to cover the whole
 * object instead of outlining it.
 */

/**
 * Fraction (0..1) of the mask canvas below which coverage is considered
 * suspiciously tiny — usually a stray stroke or an outline-only mistake.
 * ~0.5% of pixels.
 */
export const LOW_COVERAGE_WARNING_THRESHOLD = 0.005;

/**
 * Grayscale value (0–255) at or above which a pixel is considered "painted"
 * in the white-on-black inpaint mask. Both the alpha channel and the
 * luminance must independently clear this threshold to be classified as
 * masked. Used by {@link isMaskedPixel} and {@link estimateMaskCoverage}.
 */
export const MASK_PIXEL_THRESHOLD = 128;

/**
 * Classifies a single RGBA pixel as "masked" (painted, i.e. to be
 * regenerated). Mask pixels are painted white on an opaque black base, but
 * scaled exports antialias edges to gray, so classify by luminance and
 * treat low alpha as unpainted.
 */
export function isMaskedPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < MASK_PIXEL_THRESHOLD) return false;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance >= MASK_PIXEL_THRESHOLD;
}

/**
 * Estimates the fraction (0..1) of the mask canvas painted white.
 * `data` is an RGBA byte buffer; `width`/`height` are the pixel dimensions
 * of that buffer. Returns 0 for empty or malformed inputs.
 */
export function estimateMaskCoverage(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): number {
  const total = width * height;
  if (!Number.isFinite(total) || total <= 0 || data.length < total * 4) return 0;

  let masked = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (isMaskedPixel(data[o], data[o + 1], data[o + 2], data[o + 3])) {
      masked++;
    }
  }
  return masked / total;
}

/**
 * True when a mask exists but covers less than `threshold` of the canvas —
 * most likely a stray stroke or an outline-only mistake. An empty mask
 * (coverage 0) is NOT a low-coverage warning: that case belongs to the
 * canvas's empty-state hint, not to this warning.
 */
export function shouldWarnLowCoverage(
  coverage: number,
  threshold: number = LOW_COVERAGE_WARNING_THRESHOLD
): boolean {
  return Number.isFinite(coverage) && coverage > 0 && coverage < threshold;
}
