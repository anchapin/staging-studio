/**
 * Mask post-processing for the staging editor (issue #252).
 *
 * Detection masks and merged regions arrive with imperfections that hurt
 * FLUX.1 Fill quality: fused furniture leaves gaps between adjacent
 * objects, and SAM masks can enclose unpainted pockets ("donut holes")
 * that the model then treats as ground truth to preserve. Both are fixed
 * here with pure grid math so every mask reaching `/api/inpaint` is
 * closed and hole-free.
 *
 * Same binary grid convention as `mask-flood-fill.ts` / `mask-dilation.ts`:
 * a `Uint8Array` where 1 = painted (regenerated), 0 = unpainted, indexed
 * `y * width + x`. Pure: always returns a new grid and never mutates the
 * input.
 */

import { dilateMaskGrid } from "./mask-dilation";

/**
 * Maximum distance, in mask-canvas grid pixels, between two detected
 * instance masks for selection-time proximity merging (issue #252 D2).
 * Grids decode at mask-canvas dimensions (long edge ≤ 1024), so this
 * constant lives in that space. Exported for the merge logic in
 * `multi-select-batch.ts` and pinned by test.
 */
export const MERGE_PROXIMITY_PX = 5;

/** Result of a successful hole fill: the new grid and how many cells it filled. */
export interface FillHolesResult {
  /** Copy of the input grid with every enclosed hole painted (1). */
  mask: Uint8Array;
  /** Number of cells that changed from unpainted (0) to painted (1). */
  filledCount: number;
}

/**
 * Paints every enclosed unpainted region ("donut hole") in the mask.
 *
 * Algorithm: flood the background from every border cell with 4-way
 * connectivity (same connectivity as `floodFillMask`). Background cells
 * the flood never reaches are enclosed by paint — holes — and become
 * painted. Open notches touching the border are reachable, so they are
 * left untouched; there is deliberately no minimum hole size (issue
 * #252 D3: one invariant — no donut reaches FLUX). Returns null for
 * malformed geometry (non-positive or non-integer width/height, or a
 * grid shorter than width * height).
 */
export function fillHoles(
  grid: Uint8Array,
  width: number,
  height: number
): FillHolesResult | null {
  if (width <= 0 || height <= 0) return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;

  const total = width * height;
  if (grid.length < total) return null;

  const mask = grid.slice(0, total);

  // Multi-source flood over background cells starting from all border
  // cells: `outside[i] = true` marks background connected to the border.
  const outside = new Uint8Array(total);
  const stack: number[] = [];
  const pushIfBackground = (index: number): void => {
    if (mask[index] === 0 && outside[index] === 0) {
      outside[index] = 1;
      stack.push(index);
    }
  };
  for (let x = 0; x < width; x++) {
    pushIfBackground(x);
    pushIfBackground((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    pushIfBackground(y * width);
    pushIfBackground(y * width + width - 1);
  }

  let filledCount = 0;
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined) break;
    const x = index % width;
    // Left
    if (x > 0) pushIfBackground(index - 1);
    // Right
    if (x < width - 1) pushIfBackground(index + 1);
    // Up
    if (index - width >= 0) pushIfBackground(index - width);
    // Down
    if (index + width < total) pushIfBackground(index + width);
  }

  // Any background cell the border flood never reached is a hole → paint.
  for (let i = 0; i < total; i++) {
    if (mask[i] === 0 && outside[i] === 0) {
      mask[i] = 1;
      filledCount++;
    }
  }

  return { mask, filledCount };
}

/** Result of a successful closing: the new grid and its painted count. */
export interface CloseRegionResult {
  /** Copy of the input grid with gaps ≤ 2·radius bridged. */
  mask: Uint8Array;
  /** Number of painted (1) cells in the output grid. */
  paintedCount: number;
}

/**
 * Erodes a binary mask grid with a circular (Euclidean) kernel: a cell
 * stays painted only when every in-grid cell within `radius` of it is
 * painted. Implemented as the complement of dilating the complement
 * (`erode(A) = ¬dilate(¬A)`), which reuses `dilateMaskGrid`'s kernel and
 * bounds clamping: the result is 1 exactly where the whole in-grid disc
 * fits inside the paint. Internal building block of {@link closeRegion};
 * not exported — callers compose, they don't erode directly.
 */
function erodeMaskGrid(
  grid: Uint8Array,
  width: number,
  height: number,
  radius: number
): { mask: Uint8Array; paintedCount: number } | null {
  const total = width * height;
  const complement = new Uint8Array(total);
  for (let i = 0; i < total; i++) complement[i] = grid[i] === 1 ? 0 : 1;

  const dilatedComplement = dilateMaskGrid(complement, width, height, radius);
  if (!dilatedComplement) return null;

  const mask = new Uint8Array(total);
  let paintedCount = 0;
  for (let i = 0; i < total; i++) {
    if (dilatedComplement.mask[i] === 0) {
      mask[i] = 1;
      paintedCount++;
    }
  }
  return { mask, paintedCount };
}

/**
 * Morphological closing of a mask region: dilate by `radius`, then erode
 * by the same radius (issue #252 D2). Bridges seams/gaps between fused
 * objects up to 2·radius apart without growing the outer boundary by more
 * than `radius`, and is stable on shapes already "closed" (a solid shape
 * with clean surroundings maps back to itself). A radius of 0 is a
 * passthrough. Returns null for malformed geometry, mirroring
 * `dilateMaskGrid`.
 */
export function closeRegion(
  grid: Uint8Array,
  width: number,
  height: number,
  radius: number
): CloseRegionResult | null {
  const dilated = dilateMaskGrid(grid, width, height, radius);
  if (!dilated) return null;

  const eroded = erodeMaskGrid(dilated.mask, width, height, radius);
  if (!eroded) return null;

  return { mask: eroded.mask, paintedCount: eroded.paintedCount };
}
