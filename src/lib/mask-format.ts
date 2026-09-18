/**
 * Format-agnostic mask classification and recoloring for SAM detection
 * masks (issue #248).
 *
 * The live `fal-ai/sam-3-1/image` endpoint serves grayscale PNGs (white
 * object on black, NO alpha channel), but issue #228's decoder assumed
 * alpha cutouts and classified 100% of pixels as object. Both formats are
 * plausible provider outputs and no `output_format` value produces
 * cutouts, so consumers must handle both: these helpers detect which
 * format the decoded pixels are in and delegate to the matching
 * classifier, and rebuild mask pixels with alpha DERIVED FROM that
 * classification (replacing the `source-in` composites that trusted the
 * decode's alpha channel).
 */

import {
  CUTOUT_ALPHA_THRESHOLD,
  maskGridFromAlphaPixels,
  maskGridFromPixels,
} from "./mask-flood-fill";

/**
 * Converts decoded mask pixels into a binary grid (1 = object), picking
 * the classifier by format: any pixel below {@link CUTOUT_ALPHA_THRESHOLD}
 * means the mask is an alpha cutout (transparent background, photo-colored
 * object pixels — luminance would drop dark objects), so classification
 * keys on alpha alone; an all-opaque buffer is a grayscale/pixel mask
 * (white object on black), classified by luminance like the brush mask.
 * Cells beyond the available data are left unpainted. Pure.
 */
export function maskGridFromProviderPixels(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (o + 3 >= data.length) break;
    if (data[o + 3] < CUTOUT_ALPHA_THRESHOLD) {
      return maskGridFromAlphaPixels(data, width, height);
    }
  }
  return maskGridFromPixels(data, width, height);
}

/** Options for rebuilding mask pixels from their classification. */
export interface PaintMaskOptions {
  /** RGB applied to classified object pixels (e.g. white for inpaint masks). */
  maskedColor: readonly [number, number, number];
  /**
   * Fully-transparent unmasked pixels (the canvas overlay tint needs to
   * see through them); omit for the default opaque black background — the
   * white-on-black format the inpaint provider and mask pipeline speak.
   */
  transparentBackground?: boolean;
}

/**
 * Rebuilds decoded mask pixels from their FORMAT-AGNOSTIC classification:
 * object pixels become {@link PaintMaskOptions.maskedColor} at full alpha,
 * everything else becomes opaque black (or fully transparent with
 * {@link PaintMaskOptions.transparentBackground}). Alpha is derived from
 * the classification, never from the decode — a grayscale provider mask
 * decodes fully opaque, which is exactly what the replaced `source-in`
 * composites got wrong. Returns a fresh buffer; the input is not mutated.
 * Pure.
 */
export function paintMaskPixels(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: PaintMaskOptions
): Uint8ClampedArray {
  const grid = maskGridFromProviderPixels(data, width, height);
  const [r, g, b] = options.maskedColor;
  const backgroundAlpha = options.transparentBackground ? 0 : 255;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < grid.length; i++) {
    const o = i * 4;
    if (grid[i] === 1) {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    } else {
      out[o + 3] = backgroundAlpha;
    }
  }
  return out;
}
