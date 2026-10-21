/**
 * Pure dimension math for the inpaint-thumbnail downsizer.
 *
 * Extracted from `src/lib/inpaint-thumbnail.ts` so the math can be
 * pinned by `tests/thumbnail-geometry.test.ts` without pulling in the
 * browser-only `Image` / `canvas` glue. The function takes four raw
 * numbers and returns two scaled numbers; nothing else.
 *
 * The contract preserved from the legacy panel:
 * - The dominant axis (whichever is larger) is scaled to `maxDim`.
 * - The other axis is scaled proportionally.
 * - When `naturalWidth === naturalHeight === maxDim`, `scale === 1`
 *   and the returned dimensions equal the input. (When the input is
 *   smaller than `maxDim` on both axes, `Math.min(1, ...)` keeps the
 *   image at its natural size — never upscales.)
 * - Width and height are rounded to the nearest integer and clamped
 *   to a minimum of 1 so the resulting canvas is never 0×0.
 *
 * @param naturalWidth The natural pixel width of the source image.
 * @param naturalHeight The natural pixel height of the source image.
 * @param maxDim Maximum width OR height of the downsized thumbnail
 *   in CSS pixels; the other axis is scaled proportionally.
 *   Default 200 — same default as `inpaint-thumbnail.ts`.
 * @returns A `{ width, height }` pair, both integers ≥ 1.
 */
export interface ThumbnailDimensions {
  readonly width: number;
  readonly height: number;
}

export function computeThumbnailSize(
  naturalWidth: number,
  naturalHeight: number,
  maxDim: number = 200,
): ThumbnailDimensions {
  // Defensive: an image with either axis at 0 cannot be drawn;
  // the legacy function returns 1×1 in that case. Match it here so
  // a unit test pinning the same value keeps the contract honest
  // even on pathological inputs (broken image headers, zero-byte
  // decoded blob, etc.).
  const safeMax = Math.max(naturalWidth, naturalHeight, 1);
  const scale = Math.min(1, maxDim / safeMax);
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  return { width, height };
}
