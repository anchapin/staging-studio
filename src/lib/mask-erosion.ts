/**
 * Morphological erosion for the staging editor's inpaint mask (issue #1457).
 *
 * The mask uses region-replacement semantics (painted = regenerated,
 * unpainted = preserved). SAM-derived segment masks tend to be
 * *over-expanded*: the segmentation includes a halo of background pixels
 * around the object, and Qwen-Image inpaint then regenerates that halo,
 * leaving a visible bright/soft rim where the object used to be
 * ("edge halo"). Eroding the mask by a few pixels before dispatch pulls
 * the regenerated region back inside the object's real silhouette, so the
 * untouched rim stays untouched.
 *
 * Erosion is the inverse of dilation (`src/lib/mask-dilation.ts`): a
 * painted cell stays painted only when every in-grid cell of its
 * neighbourhood is painted. Same binary grid convention as
 * `mask-dilation.ts` / `mask-postprocess.ts`: a `Uint8Array` where
 * 1 = painted (regenerated), 0 = unpainted, indexed `y * width + x`.
 * Pure: always returns a new grid and never mutates the input.
 */

/**
 * Default inward shrink, in mask-canvas pixels, applied to segment-output
 * masks before they are dispatched for inpainting (issue #1457).
 *
 * Rationale: over-expanded SAM masks cause edge halos around the
 * regenerated object. The issue names a sweep range of 2–6 px as the
 * space worth trying, so the default sits in the middle of that range
 * (4 px) — enough to pull back a typical SAM halo without eating into
 * thin geometry (chair legs, plant stems) that a larger radius would
 * erase. The sweep bounds are exported so a UI affordance or an
 * experiment harness can walk the range.
 */
export const DEFAULT_SEGMENT_MASK_EROSION_RADIUS = 4;

/**
 * Lower bound of the erosion sweep range offered for segment-output masks
 * (issue #1457). 0 px means "no erosion" — the mask is dispatched exactly
 * as produced, which is the un-eroded baseline the sweep compares against.
 */
export const MIN_SEGMENT_MASK_EROSION_RADIUS = 0;

/**
 * Upper bound of the erosion sweep range named in issue #1457 (6 px).
 */
export const MAX_SEGMENT_MASK_EROSION_RADIUS = 6;

/** Result of a successful erosion: the new grid and its painted count. */
export interface ErodeMaskResult {
  /** Copy of the input grid, shrunk inward by `radius` pixels. */
  mask: Uint8Array;
  /** Number of painted (1) cells in the output grid. */
  paintedCount: number;
}

/**
 * Default preprocessing step for segment-output masks before they are
 * dispatched for inpainting (issue #1457): erode the mask by
 * {@link DEFAULT_SEGMENT_MASK_EROSION_RADIUS} pixels.
 *
 * This is the code-side half of the issue's fix; the other half is the
 * live A/B experiment (an Alibaba/Qwen-Image inpaint comparison of the
 * un-eroded mask against the eroded one), which needs paid API calls and
 * is therefore tracked as a follow-up rather than run here.
 *
 * Thin callers can pass an explicit `radius` — 0 disables the step
 * (mask dispatched as produced) and the sweep range from the issue is
 * 2–6 px ({@link MIN_SEGMENT_MASK_EROSION_RADIUS} …
 * {@link MAX_SEGMENT_MASK_EROSION_RADIUS}). Returns null for malformed
 * geometry, exactly like {@link erodeMaskGrid}.
 */
export function erodeSegmentMask(
  grid: Uint8Array,
  width: number,
  height: number,
  radius: number = DEFAULT_SEGMENT_MASK_EROSION_RADIUS
): ErodeMaskResult | null {
  return erodeMaskGrid(grid, width, height, radius);
}

/**
 * Erodes a binary mask grid with a circular (Euclidean) kernel: a cell
 * stays painted in the result only when every in-grid cell within
 * `radius` of it is painted. The neighbourhood is the same disc
 * (`dx² + dy² <= radius²`) that {@link dilateMaskGrid} stamps, so the two
 * are inverses of each other on shapes that fit inside the grid —
 * `erode(dilate(x))` recovers `x` for an interior shape, and
 * `dilate(erode(x))` recovers `x` for a shape with no thin features.
 *
 * Out-of-grid neighbours are ignored (not treated as unpainted), which
 * mirrors the bounds clamping of the dilation: a mask flush against a
 * canvas edge erodes only on its in-grid side. A radius of 0 is a
 * passthrough: the output equals the input byte-for-byte. Returns null
 * for malformed geometry (non-positive or non-integer width/height, or a
 * grid shorter than width * height); a non-finite or negative radius is
 * treated as 0.
 */
export function erodeMaskGrid(
  grid: Uint8Array,
  width: number,
  height: number,
  radius: number
): ErodeMaskResult | null {
  if (width <= 0 || height <= 0) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;

  const total = width * height;
  if (grid.length < total) return null;

  const r = Number.isFinite(radius) ? Math.max(0, Math.floor(radius)) : 0;
  const mask = grid.slice(0, total);

  if (r > 0) {
    // Precompute the circular kernel's offsets once: dx² + dy² <= r² —
    // the same disc the dilation stamps.
    const offsets: number[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          offsets.push(dx, dy);
        }
      }
    }

    // A cell survives only when its whole in-grid disc is painted.
    // Sources are read from the immutable input grid, so shrinking never
    // cascades (single-pass erosion, exactly radius r).
    for (let i = 0; i < total; i++) {
      if (grid[i] !== 1) {
        mask[i] = 0;
        continue;
      }
      const x = i % width;
      const y = (i - x) / width;
      for (let o = 0; o < offsets.length; o += 2) {
        const nx = x + offsets[o];
        const ny = y + offsets[o + 1];
        // Out-of-bounds neighbours are ignored, matching the dilation's
        // clamp: the mask never shrinks past the canvas edge.
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (grid[ny * width + nx] !== 1) {
          mask[i] = 0;
          break;
        }
      }
    }
  }

  let paintedCount = 0;
  for (let i = 0; i < total; i++) {
    if (mask[i] === 1) paintedCount++;
  }

  return { mask, paintedCount };
}
