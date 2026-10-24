/**
 * Browser-side measurement producer for the ABACUS-style scene-conservation
 * check (issue #1446, wiring slice).
 *
 * The conservation check needs per-region change scores of the pre-edit
 * frame and the edited frame. The server has no pixel access (the staged
 * images live in Supabase Storage and nothing in this repo decodes them
 * server-side), so the measurement is taken in the browser — the same
 * place the mask is painted and the same place the edit's before/after
 * images are already loaded.
 *
 * The split follows the repo convention (see `lib/thumbnail-geometry.ts`
 * + `lib/inpaint-thumbnail.ts`): the pixel math lives in the pure module
 * `lib/edit-conservation-regions.ts`, and this file is the thin browser
 * glue that decodes images into RGBA frames.
 *
 * FAILURE POLICY: any failure (image not loadable, CORS-blocked canvas
 * read, zero-sized frame) yields `null` — the caller's explicit "not
 * measured" no-op. The gate then reports no warnings. A QA check must
 * never break an edit, and it must never invent measurements.
 *
 * Side effects: reads images and allocates canvases (browser only).
 */

import {
  buildSceneConservationMeasurements,
  type RgbaFrame,
  type SceneConservationMeasurements,
} from "@/lib/edit-conservation-regions";

/**
 * Width (px) the frames are sampled at. Small enough to keep the pixel
 * pass cheap (65k pixels), large enough that a 4×4 grid still sees real
 * structure.
 */
export const CONSERVATION_SAMPLE_WIDTH = 256;

/** Upper bound on the sampled height (guards against absurd aspect ratios). */
export const CONSERVATION_MAX_SAMPLE_HEIGHT = 1024;

/**
 * Loads an image element for `url`.
 *
 * `crossOrigin = "anonymous"` matches the thumbnail generator
 * (`lib/inpaint-thumbnail.ts`): the canvas read-back below is only legal
 * for a CORS-readable image, and the storage URLs the editor uses are
 * served with CORS headers.
 *
 * Returns null when the image cannot be loaded.
 */
async function loadImageElement(url: string): Promise<HTMLImageElement | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (!url) return null;

  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * Draws an image into a fixed-size canvas and reads the RGBA pixels back.
 *
 * Returns null when the browser refuses the read-back (tainted canvas) or
 * the context is unavailable.
 */
function drawImageToFrame(
  image: HTMLImageElement,
  width: number,
  height: number
): RgbaFrame | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height);
    return { width, height, data: data.data };
  } catch {
    // Tainted canvas (the image was not CORS-readable) — no measurement.
    return null;
  }
}

/**
 * Measures the scene-conservation region scores of one edit.
 *
 * Contract:
 * - `referenceUrl` is the pre-edit frame (what the run edited);
 * - `candidateUrl` is the edited frame (the staged result);
 * - `maskDataUrl` is the edit mask (white-on-black / white-on-transparent
 *   strokes, as the editor serializes it). When it is missing, no region
 *   is exempt and the check reports every changed region;
 * - returns null when the frames cannot be measured — the caller's
 *   explicit no-op.
 *
 * Side effects: decodes images and allocates canvases (browser only).
 */
export async function measureSceneConservation(params: {
  referenceUrl: string;
  candidateUrl: string;
  maskDataUrl?: string | null;
}): Promise<SceneConservationMeasurements | null> {
  const { referenceUrl, candidateUrl, maskDataUrl } = params;

  const [referenceImage, candidateImage] = await Promise.all([
    loadImageElement(referenceUrl),
    loadImageElement(candidateUrl),
  ]);
  if (!referenceImage || !candidateImage) return null;
  if (!referenceImage.naturalWidth || !referenceImage.naturalHeight) return null;

  const width = CONSERVATION_SAMPLE_WIDTH;
  const height = Math.min(
    CONSERVATION_MAX_SAMPLE_HEIGHT,
    Math.max(1, Math.round((width * referenceImage.naturalHeight) / referenceImage.naturalWidth))
  );

  const reference = drawImageToFrame(referenceImage, width, height);
  const candidate = drawImageToFrame(candidateImage, width, height);
  if (!reference || !candidate) return null;

  let mask: RgbaFrame | null = null;
  if (maskDataUrl) {
    const maskImage = await loadImageElement(maskDataUrl);
    if (maskImage) {
      mask = drawImageToFrame(maskImage, width, height);
    }
  }

  return buildSceneConservationMeasurements({ reference, candidate, mask });
}
