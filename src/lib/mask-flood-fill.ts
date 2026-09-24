/**
 * Flood-fill helpers for the staging editor's inpaint mask.
 *
 * The mask uses region-replacement semantics (painted = regenerated,
 * unpainted = preserved). Painting interiors by hand is tedious, so the
 * editor offers a "Fill Region" tool: the stager draws a continuous outline
 * around the object, then clicks inside it to flood-fill the enclosed
 * unpainted region. Fill uses 4-way connectivity on the binary mask grid.
 */

import { isMaskedPixel } from "./mask-coverage";

/** Result of a successful flood fill: the new grid and how many cells it filled. */
export interface FloodFillResult {
  /** Copy of the input grid with the filled region painted (1). */
  mask: Uint8Array;
  /** Number of cells that changed from unpainted (0) to painted (1). */
  filledCount: number;
}

/**
 * Converts RGBA pixel data into a binary mask grid where 1 = painted
 * (masked) and 0 = unpainted. `data` is an RGBA byte buffer;
 * `width`/`height` are the pixel dimensions of that buffer. Cells beyond
 * the available data are left unpainted.
 */
export function maskGridFromPixels(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const total = width * height;
  const grid = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (o + 3 >= data.length) break;
    grid[i] = isMaskedPixel(data[o], data[o + 1], data[o + 2], data[o + 3]) ? 1 : 0;
  }
  return grid;
}

/** Alpha threshold above which a cutout pixel counts as object pixels. */
export const CUTOUT_ALPHA_THRESHOLD = 128;

/**
 * Converts RGBA pixel data into a binary mask grid using ALPHA only
 * (issue #228): 1 where the pixel's alpha is at/above
 * {@link CUTOUT_ALPHA_THRESHOLD}, 0 elsewhere. This is the right
 * classifier for SAM 3.1 detection masks — they arrive as alpha cutouts
 * (transparent background, photo-colored object pixels), so LUMINANCE
 * (what {@link maskGridFromPixels} checks via `isMaskedPixel`) would drop
 * every dark-colored object. Cells beyond the available data are left
 * unpainted.
 */
export function maskGridFromAlphaPixels(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const total = width * height;
  const grid = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (o + 3 >= data.length) break;
    grid[i] = data[o + 3] >= CUTOUT_ALPHA_THRESHOLD ? 1 : 0;
  }
  return grid;
}

/**
 * Merges two binary mask grids with OR semantics: a cell is painted in the
 * result when it is painted in either input.
 *
 * Purpose: the "Select Object" tool (issue #183) paints the SAM-detected
 * mask onto the existing painted mask without erasing manual strokes.
 * Pure: returns a fresh grid plus `addedCount`, the number of cells the
 * addition painted that the base left unpainted. Returns null when the
 * grids disagree in length.
 */
export function mergeMaskGrids(
  base: Uint8Array,
  addition: Uint8Array
): { mask: Uint8Array; addedCount: number } | null {
  if (base.length !== addition.length) return null;

  const mask = new Uint8Array(base.length);
  let addedCount = 0;
  for (let i = 0; i < base.length; i++) {
    if (base[i] === 1 || addition[i] === 1) {
      mask[i] = 1;
      if (base[i] === 0) addedCount++;
    }
  }

  return { mask, addedCount };
}

/**
 * Flood fills the unpainted region connected (4-way) to the seed cell with
 * painted cells. Pure: returns a copy of the grid; the input is not
 * mutated. Returns null when the seed is out of bounds or already painted
 * (nothing to fill).
 */
export function floodFillMask(
  grid: Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number
): FloodFillResult | null {
  if (width <= 0 || height <= 0) return null;
  if (!Number.isInteger(seedX) || !Number.isInteger(seedY)) return null;
  if (seedX < 0 || seedX >= width || seedY < 0 || seedY >= height) return null;

  const total = width * height;
  if (grid.length < total) return null;

  const seedIndex = seedY * width + seedX;
  if (grid[seedIndex] === 1) return null;

  const mask = grid.slice(0, total);
  const stack: number[] = [seedIndex];
  mask[seedIndex] = 1;
  let filledCount = 0;

  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined) break;
    filledCount++;
    const x = index % width;

    // Left
    if (x > 0 && mask[index - 1] === 0) {
      mask[index - 1] = 1;
      stack.push(index - 1);
    }
    // Right
    if (x < width - 1 && mask[index + 1] === 0) {
      mask[index + 1] = 1;
      stack.push(index + 1);
    }
    // Up
    if (index - width >= 0 && mask[index - width] === 0) {
      mask[index - width] = 1;
      stack.push(index - width);
    }
    // Down
    if (index + width < total && mask[index + width] === 0) {
      mask[index + width] = 1;
      stack.push(index + width);
    }
  }

  return { mask, filledCount };
}
