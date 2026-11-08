/**
 * Pixel helpers for the OpenAI GPT-Image inpaint provider (issue #1506,
 * following the #1502 / #1504 spikes in docs/gpt-image-2-6-evaluation.md
 * and docs/gpt-image-2-6-integration-spike.md).
 *
 * Two jobs, both pure RGBA math (PNG decode/encode lives in the
 * openai-adapter, via pngjs):
 *
 * 1. GUIDANCE MASK ENCODING. GPT Image's edits endpoint treats the mask
 *    as prompt guidance, and — the #1502 correction — it COMPOSITES any
 *    varying alpha channel of the mask into its output, flattening
 *    transparency to black. A mask whose alpha varies therefore voids
 *    the result. The encoding that works is an OPAQUE RGB guidance
 *    image: edit region painted black, keep region white, alpha 255 on
 *    every pixel. This module converts a dispatched mask (alpha cutout
 *    or grayscale white-on-black, classified by the existing
 *    format-agnostic classifier in mask-format.ts) into that encoding.
 *
 * 2. WHOLE-OBJECT COMPOSITING. When the caller knows the mask is a
 *    whole-object silhouette (its boundary lies on background), the
 *    model output can be composited inside the feathered mask over the
 *    source photo, which makes the outside region pixel-identical to
 *    the source. #1504 measured visible ghosting where a mask boundary
 *    crosses an object (the model's re-render drifts geometrically),
 *    so this must only be applied under that whole-object condition —
 *    the adapter gates it on OPENAI_INPAINT_COMPOSITE=whole-object.
 */

import { maskGridFromProviderPixels } from "./mask-format";

/**
 * Converts decoded mask pixels (either provider format) into the
 * opaque-RGB guidance encoding GPT Image requires: edit cells become
 * (0,0,0,255), keep cells become (255,255,255,255). The returned
 * buffer's alpha is 255 at every pixel — the invariant the #1502
 * correction established. Pure.
 */
export function guidanceMaskPixels(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const grid = maskGridFromProviderPixels(data, width, height);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const v = grid[i] === 1 ? 0 : 255;
    out[o] = v;
    out[o + 1] = v;
    out[o + 2] = v;
    out[o + 3] = 255;
  }
  return out;
}

/**
 * Bilinear-resizes an RGBA buffer. Used to bring the model's output
 * (1536x1024) to the source photo's dimensions before compositing.
 * Pure; deterministic.
 */
export function resizeRgbaBilinear(
  src: Uint8Array | Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  const out = new Uint8Array(dstW * dstH * 4);
  const xScale = srcW / dstW;
  const yScale = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min((y + 0.5) * yScale - 0.5, srcH - 1);
    const y0 = Math.max(Math.floor(sy), 0);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const fy = Math.min(Math.max(sy - y0, 0), 1);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min((x + 0.5) * xScale - 0.5, srcW - 1);
      const x0 = Math.max(Math.floor(sx), 0);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const fx = Math.min(Math.max(sx - x0, 0), 1);
      const o = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * srcW + x0) * 4 + c];
        const p10 = src[(y0 * srcW + x1) * 4 + c];
        const p01 = src[(y1 * srcW + x0) * 4 + c];
        const p11 = src[(y1 * srcW + x1) * 4 + c];
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        out[o + c] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return out;
}

/** Box-blurs a single-channel float field (the mask weight) in place-safe fashion. */
function boxBlurField(
  field: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  if (radius <= 0) return field;
  const tmp = new Float32Array(field.length);
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        sum += field[y * width + xx];
        n++;
      }
      tmp[y * width + x] = sum / n;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        sum += tmp[yy * width + x];
        n++;
      }
      out[y * width + x] = sum / n;
    }
  }
  return out;
}

/**
 * Composites `generated` inside the mask over `source`: pixels deep
 * inside the mask come from the model output, pixels outside come from
 * the source photo unchanged, and a feather band of `featherPx`
 * (default 6, matching the dispatch seam's erosion scale) blends the
 * two. Both inputs must already be the same dimensions — resize the
 * generated image first with {@link resizeRgbaBilinear}. Output alpha
 * is 255 everywhere. Pure.
 */
export function compositeEditedRegion(
  source: Uint8Array | Uint8ClampedArray,
  generated: Uint8Array | Uint8ClampedArray,
  grid: Uint8Array,
  width: number,
  height: number,
  featherPx = 6
): Uint8Array {
  const weight = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) weight[i] = grid[i] === 1 ? 1 : 0;
  const soft = boxBlurField(weight, width, height, Math.max(1, Math.round(featherPx / 2)));
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const a = Math.min(Math.max(soft[i], 0), 1);
    for (let c = 0; c < 3; c++) {
      out[o + c] = Math.round(generated[o + c] * a + source[o + c] * (1 - a));
    }
    out[o + 3] = 255;
  }
  return out;
}
