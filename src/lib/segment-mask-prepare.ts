/**
 * Composed segment-mask preparation (issue #1469).
 *
 * The mask-grid primitives this module composes were built for issues #252
 * (`src/lib/mask-postprocess.ts` — closing + hole fill) and #1457
 * (`src/lib/mask-erosion.ts` — erosion), but until now nothing called
 * them: the editor that used them was deleted, and the documented default
 * (`DEFAULT_SEGMENT_MASK_EROSION_RADIUS`) was honoured nowhere. The
 * preparation ORDER existed only in prose — `multi-select-batch.ts`'s
 * `BatchSelection` doc describes region masks as composed
 * "union → closing → hole fill", and #1457 puts erosion before dispatch.
 *
 * This module is the single composed, tested function a caller can invoke
 * on a segment grid:
 *
 *   erosion → closing → hole fill
 *
 * It is deliberately NOT wired into any component or route here (the
 * client seam is a separate draft); this draft delivers the pinned
 * composition that seam — and the thematic-union path — can call.
 *
 * Same binary grid convention as the primitives: a `Uint8Array` where
 * 1 = painted (regenerated), 0 = unpainted, indexed `y * width + x`.
 * Pure: always returns new buffers and never mutates the input.
 */

import {
  DEFAULT_SEGMENT_MASK_EROSION_RADIUS,
  MAX_SEGMENT_MASK_EROSION_RADIUS,
  MIN_SEGMENT_MASK_EROSION_RADIUS,
  erodeSegmentMask,
} from "./mask-erosion";
import { closeRegion, fillHoles as fillMaskHoles } from "./mask-postprocess";
import { paintMaskPixels } from "./mask-format";
import type { BatchMaskBuffer } from "./multi-select-batch";

/**
 * Options for {@link prepareSegmentMaskGrid}.
 *
 * Defaults reproduce the documented pipeline: erosion at
 * {@link DEFAULT_SEGMENT_MASK_EROSION_RADIUS} (issue #1457), no closing
 * (the closing radius is opt-in), and hole fill ON (issue #252 D3 — one
 * invariant: no donut reaches the inpaint provider).
 */
export interface SegmentMaskPrepareOptions {
  /**
   * Inward shrink, in mask-canvas pixels, applied before the rest of the
   * pipeline. Defaults to {@link DEFAULT_SEGMENT_MASK_EROSION_RADIUS};
   * clamped to the exported sweep bounds
   * ({@link MIN_SEGMENT_MASK_EROSION_RADIUS} …
   * {@link MAX_SEGMENT_MASK_EROSION_RADIUS}). 0 skips the erosion step
   * entirely (the un-eroded baseline the sweep compares against).
   */
  erosionRadius?: number;
  /**
   * Closing radius (dilate then erode) applied after erosion — 0 (the
   * default) skips the step. Bridges gaps between fused objects up to
   * 2·radius apart without growing the outer boundary (issue #252 D2).
   */
  closingRadius?: number;
  /**
   * Fill enclosed unpainted pockets ("donut holes") after closing.
   * Defaults to `true`; pass `false` to keep the holes (e.g. to compare
   * against the pre-#252 behaviour).
   */
  fillHoles?: boolean;
}

/** Result of a successful preparation: the composed grid and its coverage. */
export interface PreparedSegmentMask {
  /** The composed mask grid — a fresh buffer, never the input grid. */
  mask: Uint8Array;
  /** Number of painted (1) cells in the output grid. */
  paintedCount: number;
}

/**
 * Clamps an erosion radius to the exported sweep bounds
 * ({@link MIN_SEGMENT_MASK_EROSION_RADIUS} …
 * {@link MAX_SEGMENT_MASK_EROSION_RADIUS}). Non-finite radii collapse to
 * the minimum (no erosion). Mirrors the primitives' tolerance of a
 * negative or non-finite radius.
 */
function clampErosionRadius(radius: number): number {
  if (!Number.isFinite(radius)) return MIN_SEGMENT_MASK_EROSION_RADIUS;
  const floored = Math.floor(radius);
  if (floored < MIN_SEGMENT_MASK_EROSION_RADIUS) return MIN_SEGMENT_MASK_EROSION_RADIUS;
  if (floored > MAX_SEGMENT_MASK_EROSION_RADIUS) return MAX_SEGMENT_MASK_EROSION_RADIUS;
  return floored;
}

/**
 * Composes the documented segment-mask preparation pipeline on a binary
 * mask grid, in order:
 *
 * 1. **erosion** — inward shrink by `options.erosionRadius` (default
 *    {@link DEFAULT_SEGMENT_MASK_EROSION_RADIUS}, clamped to the exported
 *    sweep bounds; 0 skips the step). Pulls an over-expanded SAM mask
 *    back inside the object's silhouette so the regenerated region does
 *    not eat the object's rim (issue #1457).
 * 2. **closing** — only when `options.closingRadius > 0`: dilate then
 *    erode by that radius, bridging seams between fused objects (issue
 *    #252 D2).
 * 3. **hole fill** — unless `options.fillHoles === false`: paints every
 *    enclosed unpainted pocket so no donut reaches the provider (issue
 *    #252 D3).
 *
 * Returns `null` for malformed geometry (non-positive or non-integer
 * width/height, or a grid shorter than `width * height`), mirroring the
 * primitives. A grid that erosion erases away entirely is NOT an error:
 * it comes back as an all-zero grid with `paintedCount === 0`.
 *
 * The input grid is never mutated; the returned mask is always a fresh
 * buffer. Pure.
 */
export function prepareSegmentMaskGrid(
  grid: Uint8Array,
  width: number,
  height: number,
  options?: SegmentMaskPrepareOptions
): PreparedSegmentMask | null {
  if (width <= 0 || height <= 0) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;

  const total = width * height;
  if (grid.length < total) return null;

  // Own copy up front: every later step may hand the buffer on, and the
  // input must survive untouched.
  let mask: Uint8Array = grid.slice(0, total);

  // 1. Erosion (issue #1457) — skipped entirely at radius 0.
  const erosionRadius = clampErosionRadius(
    options?.erosionRadius ?? DEFAULT_SEGMENT_MASK_EROSION_RADIUS
  );
  if (erosionRadius > 0) {
    const eroded = erodeSegmentMask(mask, width, height, erosionRadius);
    if (!eroded) return null;
    mask = eroded.mask;
  }

  // 2. Closing (issue #252 D2) — only when a positive radius is passed.
  const closingRadius = options?.closingRadius ?? 0;
  if (Number.isFinite(closingRadius) && closingRadius > 0) {
    const closed = closeRegion(mask, width, height, Math.floor(closingRadius));
    if (!closed) return null;
    mask = closed.mask;
  }

  // 3. Hole fill (issue #252 D3) — on unless explicitly disabled.
  if (options?.fillHoles !== false) {
    const filled = fillMaskHoles(mask, width, height);
    if (!filled) return null;
    mask = filled.mask;
  }

  let paintedCount = 0;
  for (let i = 0; i < total; i++) {
    if (mask[i] === 1) paintedCount++;
  }

  return { mask, paintedCount };
}

/**
 * Buffer-level convenience wrapper around {@link prepareSegmentMaskGrid}:
 * prepares a segment grid and repaints it as the white-on-black RGBA
 * shape {@link unionMaskBuffers} consumes (the thematic-union path in
 * `src/lib/multi-select-batch.ts`, `BatchMaskBuffer`), so that path can
 * adopt the prepared masks without a second adapter.
 *
 * Painted cells become opaque white, unpainted cells opaque black —
 * exactly the format the inpaint provider and the mask pipeline speak.
 * Returns `null` for malformed geometry (same rule as the grid
 * function). The input grid is never mutated. Pure.
 */
export function prepareSegmentMaskBuffer(
  grid: Uint8Array,
  width: number,
  height: number,
  options?: SegmentMaskPrepareOptions
): BatchMaskBuffer | null {
  const prepared = prepareSegmentMaskGrid(grid, width, height, options);
  if (!prepared) return null;

  const total = width * height;
  // Intermediate buffer in the same white-on-black format; the shared
  // painter classifies it and rebuilds the final RGBA bytes.
  const source = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (prepared.mask[i] === 1) {
      source[o] = 255;
      source[o + 1] = 255;
      source[o + 2] = 255;
    }
    source[o + 3] = 255;
  }

  const data = paintMaskPixels(source, width, height, { maskedColor: [255, 255, 255] });
  return { width, height, data };
}
