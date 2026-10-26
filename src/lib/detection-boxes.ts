/**
 * Detection boxes for the Edit Room studio (issue #1468).
 *
 * The studio used to render two HARD-CODED placeholder detections for
 * every photo and every concept (`obj-1` at 49/57/31/42 and `obj-2` at
 * 8/58/23/27). The real detection data comes from
 * `POST /api/segment/furnishings`, which answers
 * `{concept, maskDataUrls, scores}` — one mask PNG per detected
 * instance. This module turns those masks into the percent-space
 * bounding boxes the canvas overlay and the objects list render.
 *
 * Two layers live here:
 *
 *  1. The PURE mapper (the part this module exists for):
 *     `percentBoundingBox` (binary grid → percent box) and
 *     `buildDetectedObjects` (decoded instances + concept →
 *     `DetectedObject[]`). No I/O, no DOM, no throwing.
 *  2. The browser glue `decodeMaskDataUrls` (mask data URLs → binary
 *     grids), which is the ONLY impure part. It fails soft: a mask that
 *     cannot be decoded becomes `null` instead of breaking the whole
 *     response, and the pure mapper skips those entries.
 *
 * Conventions (pinned by `tests/detection-boxes.test.ts`):
 *  - The percent box is measured against the MASK's own pixel grid, so
 *    it is directly comparable to the source photo's box space (the
 *    masks the provider returns are cut-outs at the source image's
 *    dimensions).
 *  - `x`/`y` are the box's top-left corner in percent of the grid's
 *    width/height; `w`/`h` are its size in percent. The cell COUNT is
 *    used (an inclusive span), so a single painted cell in a 10×10 grid
 *    is a 10%×10% box, not a 0%×0% one.
 *  - Detection ids are `${concept}:${index}` where `index` is the
 *    instance's position in the provider's (score-ranked) response, so
 *    an id always points back at one response slot even when an earlier
 *    mask failed to decode.
 *  - Labels are the bare concept for the first instance and
 *    `${concept} ${index + 1}` for every later one ("sofa", "sofa 2",
 *    "sofa 3", …).
 */

import { maskGridFromProviderPixels } from "@/lib/mask-format";
import type { DetectedObject } from "@/components/edit-room/detected-object-list";

/**
 * A bounding box in percent of the source image's dimensions
 * (0..100 on every axis). Mirrors `ObjectBoundingBox` from
 * `lib/canvas-coords.ts` — the shape the canvas overlay consumes.
 */
export interface PercentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One decoded instance mask: a row-major binary grid (1 = object
 * pixel, 0 = background) plus the grid's pixel dimensions.
 */
export interface DecodedInstance {
  grid: Uint8Array;
  width: number;
  height: number;
}

/**
 * The percent bounding box of the painted region of one instance mask.
 *
 * Returns `null` when the instance carries no usable geometry — a
 * non-positive / non-finite dimension, a grid shorter than
 * `width × height`, or a grid with no painted cell at all. It NEVER
 * throws: a malformed instance is skipped by the caller, not fatal.
 * Side effects: none (pure).
 */
export function percentBoundingBox(
  instance: DecodedInstance | null | undefined
): PercentBox | null {
  if (!instance) return null;
  const { grid, width, height } = instance;
  if (!grid) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (grid.length < width * height) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      if (grid[rowStart + x] !== 1) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // Nothing painted — the mask is empty, so there is no box to draw.
  if (maxX < 0 || maxY < 0) return null;

  return {
    x: (minX / width) * 100,
    y: (minY / height) * 100,
    w: ((maxX - minX + 1) / width) * 100,
    h: ((maxY - minY + 1) / height) * 100,
  };
}

/**
 * Builds the studio's detection list from the provider's decoded
 * instances.
 *
 * `instances` is the response's mask order (score-ranked). A `null`
 * entry (a mask that failed to decode) or a malformed one (bad
 * dimensions, empty grid) is SKIPPED without shifting the others'
 * indices — the id of a detection always matches the provider's
 * response position.
 *
 * Side effects: none (pure).
 */
export function buildDetectedObjects(
  concept: string,
  instances: ReadonlyArray<DecodedInstance | null | undefined>
): DetectedObject[] {
  const detections: DetectedObject[] = [];
  instances.forEach((instance, index) => {
    const box = percentBoundingBox(instance);
    if (!box) return;
    detections.push({
      id: `${concept}:${index}`,
      concept,
      label: index === 0 ? concept : `${concept} ${index + 1}`,
      box,
    });
  });
  return detections;
}

/**
 * Decodes one mask data URL into a binary grid.
 *
 * Browser-only: it loads the image into an `<img>` and reads the pixels
 * back through a canvas. The classification is the format-agnostic one
 * from `lib/mask-format.ts` (alpha cutout OR grayscale white-on-black).
 * Returns `null` when the mask cannot be decoded — a failed mask must
 * never break the whole detection response.
 */
async function decodeMaskDataUrl(dataUrl: string): Promise<DecodedInstance | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (!dataUrl || !dataUrl.startsWith("data:image/")) return null;

  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image();
    element.crossOrigin = "anonymous";
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = dataUrl;
  });
  if (!image || !image.naturalWidth || !image.naturalHeight) return null;

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  let pixels: Uint8ClampedArray;
  try {
    context.drawImage(image, 0, 0);
    pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    // Tainted canvas (the mask was not CORS-readable) — no instance.
    return null;
  }

  return {
    grid: maskGridFromProviderPixels(pixels, canvas.width, canvas.height),
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * Decodes every mask of a `/api/segment/furnishings` response into a
 * binary grid.
 *
 * The result is index-aligned with `maskDataUrls`: entry `i` is the
 * grid of mask `i`, or `null` when that mask could not be decoded. The
 * alignment is what lets the detection ids keep referring to the
 * provider's response positions.
 *
 * Side effects: reads images and allocates canvases (browser only).
 */
export async function decodeMaskDataUrls(
  maskDataUrls: ReadonlyArray<string>
): Promise<Array<DecodedInstance | null>> {
  return Promise.all(maskDataUrls.map((dataUrl) => decodeMaskDataUrl(dataUrl)));
}
