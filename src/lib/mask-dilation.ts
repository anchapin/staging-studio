/**
 * Morphological dilation for the staging editor's inpaint mask (issue #180).
 *
 * The mask uses region-replacement semantics (painted = regenerated,
 * unpainted = preserved), and a hand-painted or SAM-derived mask stops
 * exactly at the object's visual boundary. FLUX.1 Fill then treats the
 * unmasked perimeter — bezels, frames, brackets, mounts — as structural
 * ground truth to preserve, leaving a "ghost rim" around the replacement.
 * Growing the mask outward by a few pixels before export makes the model
 * regenerate that boundary too.
 *
 * Same binary grid convention as `mask-flood-fill.ts` / `mask-coverage.ts`:
 * a `Uint8Array` where 1 = painted (regenerated), 0 = unpainted, indexed
 * `y * width + x`. Pure: always returns a new grid and never mutates the
 * input.
 */

/**
 * Default outward growth, in mask-canvas pixels, applied to the dispatched
 * mask (issue #180: enough to swallow a typical bezel/frame rim).
 */
export const DEFAULT_MASK_EXPANSION_RADIUS = 15;

/**
 * Upper bound the UI offers for mask expansion (issue #180: tunable
 * 15–25px, 0 restores the un-dilated mask). The pure dilation itself
 * accepts any non-negative radius; this bound is a UI affordance.
 */
export const MAX_MASK_EXPANSION_RADIUS = 25;

/** Result of a successful dilation: the new grid and its painted count. */
export interface DilateMaskResult {
  /** Copy of the input grid, grown outward by `radius` pixels. */
  mask: Uint8Array;
  /** Number of painted (1) cells in the output grid. */
  paintedCount: number;
}

/**
 * Dilates a binary mask grid with a circular (Euclidean) kernel: a cell is
 * painted in the result when at least one painted input cell lies within
 * `radius` of it. Growth is clamped to the grid bounds, so masks touching
 * an edge never expand past it. A radius of 0 is a passthrough: the output
 * equals the input byte-for-byte. Returns null for malformed geometry
 * (non-positive or non-integer width/height, or a grid shorter than
 * width * height); a non-finite or negative radius is treated as 0.
 */
export function dilateMaskGrid(
  grid: Uint8Array,
  width: number,
  height: number,
  radius: number
): DilateMaskResult | null {
  if (width <= 0 || height <= 0) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;

  const total = width * height;
  if (grid.length < total) return null;

  const r = Number.isFinite(radius) ? Math.max(0, Math.floor(radius)) : 0;
  const mask = grid.slice(0, total);

  if (r > 0) {
    // Precompute the circular kernel's offsets once: dx² + dy² <= r².
    const offsets: number[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          offsets.push(dx, dy);
        }
      }
    }

    // Stamp the disc around every source painted cell. Sources are read
    // from the immutable input grid, so newly painted cells never seed
    // further growth (single-pass dilation, exactly radius r).
    for (let i = 0; i < total; i++) {
      if (grid[i] !== 1) continue;
      const x = i % width;
      const y = (i - x) / width;
      for (let o = 0; o < offsets.length; o += 2) {
        const nx = x + offsets[o];
        const ny = y + offsets[o + 1];
        // In-bounds clamp: never paint outside the canvas.
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        mask[ny * width + nx] = 1;
      }
    }
  }

  let paintedCount = 0;
  for (let i = 0; i < total; i++) {
    if (mask[i] === 1) paintedCount++;
  }

  return { mask, paintedCount };
}
