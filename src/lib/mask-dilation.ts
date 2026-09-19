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
 * Options for {@link dilateMaskGridDirectional}.
 *
 * Issue #234: floor-shadow inclusion requires anisotropic dilation — the mask
 * must grow further downward (toward the floor) than upward, so the dark
 * shadow pool cast on the floor gets swallowed by the regenerated region
 * alongside the object's footprint.
 */
export interface DilateMaskDirectionalOptions {
  /**
   * When true, dilate further downward (positive Y) than upward. The upward
   * dilation stays at `radius`; the downward dilation extends to `k * radius`
   * (see `verticalBias`). When false (the default), behaves identically to
   * {@link dilateMaskGrid}: isotropic circular kernel.
   */
  includeFloorShadow?: boolean;
  /**
   * Vertical bias multiplier for downward growth (issue #234). Downward
   * extension = `verticalBias * radius`. Must be >= 1. A value of 2 means
   * the downward dilation reaches 2× the radius below the source cell while
   * upward stays at the isotropic radius. Defaults to 2 (the conservative
   * midpoint of the 2–3 range the issue suggests).
   */
  verticalBias?: number;
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

/**
 * Directional dilation that extends further toward the floor (positive Y)
 * than upward (issue #234: floor-shadow toggle).
 *
 * When `options.includeFloorShadow` is false (the default), this function
 * produces byte-identical output to {@link dilateMaskGrid} with the same
 * radius — the isotropic circular kernel. The anisotropy is ONLY applied when
 * `includeFloorShadow` is true.
 *
 * The anisotropic kernel:
 * - Horizontal: ±radius (same as isotropic)
 * - Vertical upward (dy < 0): -radius .. -1, max |dy| = radius
 * - Vertical downward (dy > 0): 1 .. k*radius, max dy = floor(k*radius)
 *
 * Radius 0 is always a passthrough regardless of `includeFloorShadow`.
 * Returns null for the same malformed-geometry cases as {@link dilateMaskGrid}.
 */
export function dilateMaskGridDirectional(
  grid: Uint8Array,
  width: number,
  height: number,
  radius: number,
  options?: DilateMaskDirectionalOptions
): DilateMaskResult | null {
  if (width <= 0 || height <= 0) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;

  const total = width * height;
  if (grid.length < total) return null;

  const r = Number.isFinite(radius) ? Math.max(0, Math.floor(radius)) : 0;
  const includeFloorShadow = options?.includeFloorShadow ?? false;
  const vb = options?.verticalBias ?? NaN;
  const k = !Number.isFinite(vb) || vb < 1 ? 1 : vb;
  const mask = grid.slice(0, total);

    if (r > 0) {
    // Precompute the anisotropic kernel offsets.
    // Horizontal: ±r in both directions.
    // Upward: same as isotropic (dy = -r .. -1).
    // Downward: extends to floor(k * r) instead of just r.
    const maxDownward = Math.floor(k * r);
    const offsets: number[] = [];

    if (includeFloorShadow) {
      // Full anisotropic kernel: horizontal ±r, upward -r, downward k·r.
      // Downward uses an elliptical constraint: (dx/r)² + (k·dy/r)² <= 1.
      // This produces an ellipse stretched vertically by k: horizontal radius r,
      // vertical radius k·r. At dy>0 the horizontal cross-section shrinks,
      // allowing the kernel to reach further down without spreading outward.
      for (let dy = -r; dy <= maxDownward; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dy < 0) {
            // Upward: standard circular Euclidean constraint.
            if (dx * dx + dy * dy <= r * r) {
              offsets.push(dx, dy);
            }
          } else {
            // Same row or downward (dy >= 0): elliptical constraint — (dx/r)² + (dy/(k·r))² <= 1
            // ⟺  dx² + dy²/k² <= r²
            // This ellipse has horizontal radius r and vertical radius k·r.
            // At dy=0: dx² <= r² → dx ∈ {-1, 0, 1} (same as isotropic, 3 cells)
            // At dy>0: shrinks horizontally as we go down.
            if (dx * dx + (dy * dy) / (k * k) <= r * r) {
              offsets.push(dx, dy);
            }
          }
        }
      }
    } else {
      // Isotropic fallback — byte-identical to dilateMaskGrid.
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r * r) {
            offsets.push(dx, dy);
          }
        }
      }
    }

    for (let i = 0; i < total; i++) {
      if (grid[i] !== 1) continue;
      const x = i % width;
      const y = (i - x) / width;
      for (let o = 0; o < offsets.length; o += 2) {
        const nx = x + offsets[o];
        const ny = y + offsets[o + 1];
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
