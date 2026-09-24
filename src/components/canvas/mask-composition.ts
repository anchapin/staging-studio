/**
 * Browser-only mask composition & provider-mask decoding utilities
 * (extracted verbatim from inpaint-editor.tsx by issue #691).
 *
 * Everything here touches `document`/`Image` and therefore only runs in
 * the browser; the pure grid math they drive stays in `src/lib/*`
 * (mask-format, mask-flood-fill, mask-postprocess, multi-select-batch).
 */

import {
  maskGridFromProviderPixels,
  paintMaskPixels,
} from "@/lib/mask-format";
import { maskGridFromPixels } from "@/lib/mask-flood-fill";
import { fillHoles, closeRegion } from "@/lib/mask-postprocess";
import { unionMaskBuffers } from "@/lib/multi-select-batch";

/** Resolves when the image is loaded; rejects on a load error. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load."));
    img.src = src;
  });
}

/**
 * OR-composes every selection's mask into one union-mask data URL (issue
 * #203 thematic mode). Decodes each mask at natural dimensions, runs the
 * pure `unionMaskBuffers` composition, and serializes the result.
 * Browser-only.
 */
export async function composeUnionMaskDataUrl(
  maskDataUrls: string[],
  width: number,
  height: number
): Promise<string | null> {
  if (maskDataUrls.length === 0) return null;
  const buffers = await decodeMaskBuffers(maskDataUrls, width, height);
  if (!buffers) return null;
  const union = unionMaskBuffers(buffers);
  if (!union) return null;

  // Issue #252 D3: hole-fill the union at composition (filling runs last —
  // unioning region masks can seal new enclosed pockets), so the thematic
  // run never receives a donut.
  const unionGrid = maskGridFromPixels(union.data, union.width, union.height);
  const filledUnion = fillHoles(unionGrid, union.width, union.height);
  if (filledUnion) {
    const unionData = union.data;
    for (let i = 0; i < filledUnion.mask.length; i++) {
      const o = i * 4;
      if (filledUnion.mask[i] === 1) {
        unionData[o] = 255;
        unionData[o + 1] = 255;
        unionData[o + 2] = 255;
      }
      unionData[o + 3] = 255;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(union.data), union.width, union.height),
    0,
    0
  );
  return canvas.toDataURL("image/png");
}

/**
 * Rasterizes one instance crop from the displayed source image for the
 * batched vision-labeling call (issue #252 D4): crops the instance's
 * bounding box (plus 4% context padding) at the photo's natural
 * dimensions, downscales the long edge to 320px to keep the vision
 * request cheap, and serializes as JPEG. Null when the image or crop
 * fails. Browser-only.
 */
export async function cropInstanceDataUrl(
  sourceImg: HTMLImageElement,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  naturalDims: { width: number; height: number }
): Promise<string | null> {
  const padX = Math.round((bounds.maxX - bounds.minX + 1) * 0.04);
  const padY = Math.round((bounds.maxY - bounds.minY + 1) * 0.04);
  const cropX = Math.max(0, bounds.minX - padX);
  const cropY = Math.max(0, bounds.minY - padY);
  const cropW = Math.min(naturalDims.width, bounds.maxX + 1 + padX) - cropX;
  const cropH = Math.min(naturalDims.height, bounds.maxY + 1 + padY) - cropY;
  if (cropW <= 0 || cropH <= 0) return null;

  const long = Math.max(cropW, cropH);
  const scale = long > 320 ? 320 / long : 1;
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(sourceImg, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
  try {
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

/** Decodes mask data URLs into RGBA buffers at one shared geometry. Browser-only. */
export async function decodeMaskBuffers(
  maskDataUrls: string[],
  width: number,
  height: number
): Promise<Array<{ width: number; height: number; data: Uint8ClampedArray }> | null> {
  const buffers: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [];
  for (const url of maskDataUrls) {
    try {
      const img = await loadImage(url);
      const layer = document.createElement("canvas");
      layer.width = width;
      layer.height = height;
      const layerCtx = layer.getContext("2d");
      if (!layerCtx) return null;
      layerCtx.drawImage(img, 0, 0, width, height);
      buffers.push({
        width,
        height,
        data: layerCtx.getImageData(0, 0, width, height).data,
      });
    } catch {
      return null;
    }
  }
  return buffers;
}

/**
 * Composes one merged region's mask (issue #252 D2/D3): union the member
 * masks, morphologically close with the proximity radius scaled to natural
 * dimensions (bridges the seam between fused objects), then fill holes
 * (closing can seal new pockets; filling runs last). Browser-only.
 */
export async function composeRegionMaskDataUrl(
  maskDataUrls: string[],
  width: number,
  height: number,
  closeRadius: number
): Promise<string | null> {
  if (maskDataUrls.length === 0) return null;
  const buffers = await decodeMaskBuffers(maskDataUrls, width, height);
  if (!buffers) return null;
  const union = unionMaskBuffers(buffers);
  if (!union) return null;

  const unionGrid = maskGridFromPixels(union.data, union.width, union.height);
  const closed = closeRegion(unionGrid, width, height, closeRadius);
  const closedGrid = closed ? closed.mask : unionGrid;
  const filled = fillHoles(closedGrid, width, height);
  const finalGrid = filled ? filled.mask : closedGrid;

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < finalGrid.length; i++) {
    const o = i * 4;
    if (finalGrid[i] === 1) {
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
    }
    data[o + 3] = 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(data, width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

// -------------------------------------------------------------------------
// Issue #228: SAM 3.1 concept-instance decoding. The detection route
// returns per-instance masks whose provider format varies — live captures
// (issue #248) show grayscale white-on-black PNGs with NO alpha channel,
// while #228 assumed alpha cutouts — so grid extraction goes through the
// format-agnostic classifier and the toggle path rebuilds each mask as
// white-on-black from that classification (the same derived-alpha
// technique every SAM-mask consumer now shares).
// -------------------------------------------------------------------------

/** One decoded detection instance, in response order (score-ranked). */
export interface DecodedInstance {
  grid: Uint8Array;
  width: number;
  height: number;
  /** Provider confidence, or null when the response omitted it. */
  score: number | null;
  /** White-on-black mask at the photo's natural dimensions (toggle path). */
  whiteMaskDataUrl: string;
}

/**
 * Decodes one provider mask (grayscale or alpha-cutout — the classifier
 * detects the format) into a hit-test grid (at `gridDims`, the
 * mask-canvas resolution — click points arrive in that space) plus a
 * white-on-black data URL at the photo's natural dimensions. Returns
 * null when the image fails to decode; the caller preserves the slot so
 * response indices stay stable. Browser-only.
 */
export async function decodeConceptInstance(
  maskDataUrl: string,
  score: number | null,
  gridDims: { width: number; height: number },
  naturalDims: { width: number; height: number }
): Promise<DecodedInstance | null> {
  try {
    const img = await loadImage(maskDataUrl);

    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = gridDims.width;
    gridCanvas.height = gridDims.height;
    const gridCtx = gridCanvas.getContext("2d");
    if (!gridCtx) return null;
    gridCtx.drawImage(img, 0, 0, gridDims.width, gridDims.height);
    const gridPixels = gridCtx.getImageData(0, 0, gridDims.width, gridDims.height);

    const whiteCanvas = document.createElement("canvas");
    whiteCanvas.width = naturalDims.width;
    whiteCanvas.height = naturalDims.height;
    const whiteCtx = whiteCanvas.getContext("2d");
    if (!whiteCtx) return null;
    whiteCtx.drawImage(img, 0, 0, naturalDims.width, naturalDims.height);
    const painted = paintMaskPixels(
      whiteCtx.getImageData(0, 0, naturalDims.width, naturalDims.height).data,
      naturalDims.width,
      naturalDims.height,
      { maskedColor: [255, 255, 255] }
    );

    // Issue #252 D3: hole-fill the region mask at composition time so the
    // canvas tint and the dispatched mask are identical and donut-free
    // (WYSIWYG). The natural-resolution mask is re-classified from the
    // painted buffer (white-on-black is stable through the classifier),
    // hole-filled, and written back as pure white/black pixels.
    const naturalGrid = maskGridFromProviderPixels(
      painted,
      naturalDims.width,
      naturalDims.height
    );
    const filledNatural = fillHoles(naturalGrid, naturalDims.width, naturalDims.height);
    if (filledNatural && filledNatural.filledCount > 0) {
      for (let i = 0; i < filledNatural.mask.length; i++) {
        const o = i * 4;
        if (filledNatural.mask[i] === 1) {
          painted[o] = 255;
          painted[o + 1] = 255;
          painted[o + 2] = 255;
          painted[o + 3] = 255;
        } else {
          painted[o] = 0;
          painted[o + 1] = 0;
          painted[o + 2] = 0;
          painted[o + 3] = 255;
        }
      }
    }
    whiteCtx.putImageData(
      new ImageData(new Uint8ClampedArray(painted), naturalDims.width, naturalDims.height),
      0,
      0
    );

    // Same invariant for the hit-test grid the toggle path reasons about.
    let grid = maskGridFromProviderPixels(
      gridPixels.data,
      gridDims.width,
      gridDims.height
    );
    const filledGrid = fillHoles(grid, gridDims.width, gridDims.height);
    if (filledGrid) grid = filledGrid.mask;

    return {
      grid,
      width: gridDims.width,
      height: gridDims.height,
      score,
      whiteMaskDataUrl: whiteCanvas.toDataURL("image/png"),
    };
  } catch {
    return null;
  }
}

/**
 * Decodes every instance of a concept result, preserving response order
 * (and null slots for undecodable masks) so `selection_logged` indices
 * keep matching the provider response. Browser-only.
 */
export async function decodeConceptInstances(
  result: { maskDataUrls: string[]; scores: number[] },
  gridDims: { width: number; height: number },
  naturalDims: { width: number; height: number }
): Promise<Array<DecodedInstance | null>> {
  return Promise.all(
    result.maskDataUrls.map((maskDataUrl, index) =>
      decodeConceptInstance(maskDataUrl, result.scores[index] ?? null, gridDims, naturalDims)
    )
  );
}
