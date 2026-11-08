/**
 * Issue #1457 — the mask preparation applied on the segment→inpaint
 * dispatch seam.
 *
 * The erosion primitive (`src/lib/mask-erosion.ts`) and the composed
 * pipeline (`src/lib/segment-mask-prepare.ts`, issue #1469) both existed
 * with ZERO production callers, so the documented 4 px default
 * (`DEFAULT_SEGMENT_MASK_EROSION_RADIUS`) was honoured nowhere.
 *
 * This module is the ADAPTER that lets the dispatch seam call the pinned
 * `prepareSegmentMaskGrid` on a mask that is about to be handed to the
 * inpaint provider. It adds no erosion logic of its own: the erosion,
 * the closing and the hole fill all live in `segment-mask-prepare.ts`
 * and are called, never re-implemented.
 *
 * Where it plugs in (the traced dispatch seam): EVERY mask that reaches
 * `POST /api/inpaint` is posted from `beginInpaintRun` in
 * `src/components/canvas/use-inpaint-runs.ts` — the shared submit path
 * used by
 *
 *  - brush runs (`submitInpaint` → `beginInpaintRun`),
 *  - the thematic-union run (`handleBatchRun` → `plan.maskDataUrl`),
 *  - the per-object SAM region runs (`runPerObjectBatch` →
 *    `plan.steps[i].maskDataUrl`, the segment-output masks),
 *  - the holistic runs (`submitHolisticRun`).
 *
 * So one call here covers the segment-output masks AND the brush masks.
 *
 * Format preservation: the mask that reaches the seam is a PNG data URL
 * in one of two provider formats (see `src/lib/mask-format.ts`):
 *
 *  - an ALPHA CUTOUT (transparent background, opaque object pixels) —
 *    what the brush canvas and SAM 3.1 produce; the region is marked by
 *    ALPHA, and
 *  - an opaque GRAYSCALE white-on-black mask — the region is marked by
 *    LUMINANCE.
 *
 * The preparation never changes which format the mask speaks: painted
 * pixels become the canonical mask colour (white — the colour the
 * inpaint provider and the mask pipeline speak, so the luminance and
 * the alpha semantics agree) and keep their original alpha (so a
 * feathered brush mask keeps its soft edge), and unpainted pixels are
 * flattened to the format's own background (transparent for a cutout,
 * opaque black for a grayscale mask).
 *
 * Pure pixel math lives in {@link prepareMaskPixelsForDispatch} (no DOM,
 * unit-testable); the browser glue (PNG decode → prepare → PNG encode)
 * lives in {@link prepareMaskForDispatch}.
 */

import { CUTOUT_ALPHA_THRESHOLD } from "./mask-flood-fill";
import { maskGridFromProviderPixels } from "./mask-format";
import {
  prepareSegmentMaskGrid,
  type SegmentMaskPrepareOptions,
} from "./segment-mask-prepare";

/**
 * Decoded mask pixels: RGBA bytes (4 per pixel) plus the pixel
 * dimensions of the mask bitmap.
 */
export interface DecodedMaskPixels {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/**
 * The browser-side PNG codec the dispatch seam uses. Injectable so the
 * seam function itself (not just its pixel math) can be unit-tested
 * without a DOM.
 */
export interface MaskCodec {
  /** Decodes a mask data URL into pixels; `null` when it cannot. */
  decode(dataUrl: string): Promise<DecodedMaskPixels | null>;
  /** Re-encodes pixels back into a mask data URL. */
  encode(pixels: DecodedMaskPixels): string;
}

/**
 * True when the mask speaks the alpha-cutout format (at least one
 * pixel below the cutout alpha threshold ⇒ the region is marked by
 * alpha, not by luminance). Mirrors the classifier choice inside
 * `maskGridFromProviderPixels`.
 */
function isCutoutFormat(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): boolean {
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (o + 3 >= data.length) break;
    if (data[o + 3] < CUTOUT_ALPHA_THRESHOLD) return true;
  }
  return false;
}

/**
 * Applies the pinned segment-mask preparation (`prepareSegmentMaskGrid`
 * — erosion at the documented 4 px default, hole fill on, no closing)
 * to decoded mask PIXELS.
 *
 * Contract:
 *  - malformed geometry (non-positive / non-integer dimensions, or a
 *    buffer shorter than `width × height × 4`) returns `null`;
 *  - the painted region comes back ERODED by the default radius
 *    (`DEFAULT_SEGMENT_MASK_EROSION_RADIUS`, 4 px) unless the caller
 *    passes `erosionRadius: 0`;
 *  - enclosed unpainted pockets are filled (the `fillHoles` default),
 *    so no donut reaches the provider;
 *  - painted pixels become the canonical mask colour (white) and keep
 *    their original alpha (a feathered mask keeps its soft edge); unpainted pixels are flattened to the
 *    mask format's own background — fully transparent for an alpha
 *    cutout, opaque black for a grayscale mask;
 *  - the input buffer is never mutated; a fresh buffer is returned.
 *
 * Pure: no DOM, no I/O.
 */
export function prepareMaskPixelsForDispatch(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options?: SegmentMaskPrepareOptions
): Uint8ClampedArray<ArrayBuffer> | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  const total = width * height;
  if (data.length < total * 4) return null;

  // The pinned composition — erosion (default 4 px) → closing (off by
  // default) → hole fill (on by default). No erosion logic here.
  const grid = maskGridFromProviderPixels(data, width, height);
  const prepared = prepareSegmentMaskGrid(grid, width, height, options);
  if (!prepared) return null;

  const cutout = isCutoutFormat(data, width, height);
  const out = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (prepared.mask[i] === 1) {
      // Painted: the canonical mask colour (white — the colour the
      // inpaint provider and the mask pipeline speak, so the luminance
      // and the alpha semantics agree), and the ORIGINAL alpha so a
      // feathered brush mask keeps its soft edge. A pixel the hole fill
      // newly painted was fully transparent — it must become visible, so
      // it gets full alpha.
      out[o] = 255;
      out[o + 1] = 255;
      out[o + 2] = 255;
      out[o + 3] = data[o + 3] === 0 ? 255 : data[o + 3];
    } else {
      // Unpainted: the format's own background.
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = cutout ? 0 : 255;
    }
  }
  return out;
}

/**
 * The browser-side PNG codec: decode a mask data URL into pixels, read
 * them back through a canvas, and re-encode. Mirrors the codec
 * `src/lib/mask-feather.ts` uses for the same pre-upload purpose.
 */
const BROWSER_CODEC: MaskCodec = {
  async decode(dataUrl: string): Promise<DecodedMaskPixels | null> {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return null;
    }
    if (typeof createImageBitmap !== "function") return null;

    const response = await fetch(dataUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return { data: imageData.data, width: canvas.width, height: canvas.height };
  },

  encode(pixels: DecodedMaskPixels): string {
    const canvas = document.createElement("canvas");
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("prepareMaskForDispatch: 2D canvas context unavailable");
    }
    context.putImageData(
      new ImageData(pixels.data, pixels.width, pixels.height),
      0,
      0
    );
    return canvas.toDataURL("image/png");
  },
};

/**
 * Prepares a mask data URL for dispatch to the inpaint provider.
 *
 * This is the function the dispatch seam calls. It decodes the mask,
 * runs the pinned `prepareSegmentMaskGrid` composition over it (default
 * options ⇒ erosion at the documented 4 px radius, hole fill on, no
 * closing) and re-encodes the result.
 *
 * Contract:
 *  - a mask that cannot be decoded, or a geometry the preparation
 *    rejects, is returned UNCHANGED (a failed preparation must never
 *    block an inpaint run);
 *  - the function never throws — a broken codec or a tainted canvas
 *    degrades to the original mask;
 *  - in a non-DOM context (server render, unit test) the mask is
 *    returned unchanged.
 *
 * `codec` is injectable so the seam can be exercised without a DOM.
 */
export async function prepareMaskForDispatch(
  maskDataUrl: string,
  options?: SegmentMaskPrepareOptions,
  codec: MaskCodec = BROWSER_CODEC
): Promise<string> {
  if (!maskDataUrl) return maskDataUrl;
  try {
    const decoded = await codec.decode(maskDataUrl);
    if (!decoded) return maskDataUrl;

    const prepared = prepareMaskPixelsForDispatch(
      decoded.data,
      decoded.width,
      decoded.height,
      options
    );
    if (!prepared) return maskDataUrl;

    return codec.encode({
      data: prepared,
      width: decoded.width,
      height: decoded.height,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "segment_mask_prepare_failed",
        message: error instanceof Error ? error.message : String(error),
      })
    );
    return maskDataUrl;
  }
}
