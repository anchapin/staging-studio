/**
 * Client-side instance hit-testing for SAM 3.1 concept selections
 * (issue #228).
 *
 * One detection call per (image, concept) returns ALL instances, so a
 * click never needs a provider round-trip: it only needs to find which
 * instance's mask contains the clicked pixel. This module is that pure
 * lookup.
 *
 * Coordinate conventions (see `canvas-coords.ts`): the caller converts
 * the raw click into the SAME pixel space the grids were decoded at —
 * in the editor both are the logical mask-canvas dimensions (`dims`), so
 * the canvas-space point goes in unchanged. Points floor to the
 * containing cell (a click at (10.9, 3.2) hits cell (10, 3), matching
 * how the brush/paint pipeline rasterizes).
 *
 * Instances arrive score-ranked (index 0 = highest score — the order the
 * `POST /api/segment/furnishings` response returns them in), and array
 * order IS the rank: when instances overlap, the earlier (better-scoring)
 * the earlier (better-scoring) one wins, so a click on a sofa that
 * overlaps a rug toggles the sofa.
 *
 * Side effects: none (pure lookup).
 */

/** One decoded instance mask as a binary grid (1 = object, 0 = background). */
export interface InstanceMaskGrid {
  /** Row-major binary grid; length ≥ width × height. */
  grid: Uint8Array;
  width: number;
  height: number;
}

/**
 * Finds the instance whose mask contains the point.
 *
 * Contract: `instances` is in score-ranked order; a `null` entry (a mask
 * that failed to decode client-side) is skipped WITHOUT shifting the
 * indices of the others — `instanceIndex` in `selection_logged` events
 * must keep referring to the provider's response positions. Returns the
 * FIRST (best-ranked) instance containing the floored point, or `null`
 * when the point falls outside every instance (or off-grid entirely).
 * Degenerate geometry (non-positive dims, or a grid shorter than
 * width × height) skips that instance rather than throwing.
 * Side effects: none (pure).
 */
export function findInstanceAtPoint(
  instances: readonly (InstanceMaskGrid | null)[],
  point: { x: number; y: number }
): number | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const cellX = Math.floor(point.x);
  const cellY = Math.floor(point.y);

  for (let index = 0; index < instances.length; index++) {
    const instance = instances[index];
    if (!instance) continue;
    const { grid, width, height } = instance;
    if (width <= 0 || height <= 0) continue;
    if (grid.length < width * height) continue;
    if (cellX < 0 || cellY < 0 || cellX >= width || cellY >= height) continue;
    if (grid[cellY * width + cellX] === 1) return index;
  }
  return null;
}

/**
 * A deterministic representative point for one detected instance: its
 * first set pixel in row-major order (issue #249). "Select all detected"
 * builds each batch entry from this point so the entries inherit the
 * reducer's duplicate-point rule exactly like click toggles do.
 *
 * Contract: returns `null` when the grid has no set pixel or is degenerate
 * (non-positive dims, or shorter than width × height — the same skip rules
 * as {@link findInstanceAtPoint}). Side effects: none (pure).
 */
export function instanceSeedPoint(
  instance: InstanceMaskGrid
): { x: number; y: number } | null {
  const { grid, width, height } = instance;
  if (width <= 0 || height <= 0) return null;
  if (grid.length < width * height) return null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y * width + x] === 1) return { x, y };
    }
  }
  return null;
}
