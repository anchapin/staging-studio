/**
 * Region-layer measurements for the ABACUS-style scene-conservation check
 * (issue #1446, wiring slice).
 *
 * PROVENANCE: `src/lib/edit-conservation.ts` implements the deterministic
 * scene-conservation check over caller-supplied per-region change scores
 * (`ConservationRegion`). This module is the measurement producer for that
 * check: it turns two RGBA frames (the pre-edit reference and the edited
 * candidate) plus the edit mask into the exact shape the check consumes.
 *
 * The measurement is deliberately coarse and cheap: the frame is sampled on
 * a fixed grid and every grid cell becomes one region. A region's
 * `changedFraction` is the fraction of its pixels whose RGB differs from
 * the reference by more than `pixelTolerance`. Grid cells covered by the
 * edit mask are exempt (changes there are the point of the edit) — the
 * check itself also honours the per-region `insideMask` flag, and the
 * mask's region ids are passed as the mask's exempt list too.
 *
 * NOTHING here invents data: the "before" frame's change scores are the
 * reference's own baseline (the pre-edit frame IS the reference, so its
 * baseline change is 0 by definition) and every score is computed from
 * real pixels. When the caller has no frames (or the frames disagree on
 * dimensions) the helpers return empty results, which the caller treats
 * as "not measured" — an explicit no-op, never a fabricated measurement.
 *
 * Side effects: none — every exported function is pure.
 */

import { isMaskedPixel } from "@/lib/mask-coverage";
import type { ConservationRegion, EditMask } from "@/lib/edit-conservation";

/** A decoded RGBA image (the `getImageData` shape). */
export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Tuning knobs for the region grid. */
export interface RegionGridOptions {
  /** Number of grid rows. Defaults to {@link DEFAULT_REGION_GRID_ROWS}. */
  rows?: number;
  /** Number of grid columns. Defaults to {@link DEFAULT_REGION_GRID_COLUMNS}. */
  columns?: number;
  /**
   * Per-pixel RGB delta (0–255) above which a pixel counts as changed.
   * Defaults to {@link DEFAULT_REGION_PIXEL_TOLERANCE}.
   */
  pixelTolerance?: number;
  /**
   * Fraction of a grid cell that must be covered by the mask for the cell
   * to be exempt. Defaults to {@link DEFAULT_MIN_MASK_COVERAGE}.
   */
  minMaskCoverage?: number;
}

/** Default number of grid rows (regions are square-ish on a landscape photo). */
export const DEFAULT_REGION_GRID_ROWS = 4;
/** Default number of grid columns. */
export const DEFAULT_REGION_GRID_COLUMNS = 4;
/**
 * Default per-pixel RGB delta above which a pixel counts as changed.
 * 8/255 is above the JPEG noise floor of the staged images but well below
 * any visible restaging change.
 */
export const DEFAULT_REGION_PIXEL_TOLERANCE = 8;
/**
 * Default fraction of a grid cell that must be masked for the cell to be
 * exempt from the conservation check.
 */
export const DEFAULT_MIN_MASK_COVERAGE = 0.5;

/** The stable id of one grid cell, e.g. `r1c2`. */
export function regionId(row: number, column: number): string {
  return `r${row}c${column}`;
}

/** Resolves the grid dimensions, falling back to the defaults. */
function resolveGrid(options?: RegionGridOptions): {
  rows: number;
  columns: number;
} {
  const rows =
    typeof options?.rows === "number" && Number.isFinite(options.rows)
      ? Math.max(1, Math.trunc(options.rows))
      : DEFAULT_REGION_GRID_ROWS;
  const columns =
    typeof options?.columns === "number" && Number.isFinite(options.columns)
      ? Math.max(1, Math.trunc(options.columns))
      : DEFAULT_REGION_GRID_COLUMNS;
  return { rows, columns };
}

/** Resolves the per-pixel tolerance, falling back to the default. */
function resolvePixelTolerance(options?: RegionGridOptions): number {
  const tolerance = options?.pixelTolerance;
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance)) {
    return DEFAULT_REGION_PIXEL_TOLERANCE;
  }
  return Math.min(255, Math.max(0, tolerance));
}

/** Resolves the mask-coverage floor, falling back to the default. */
function resolveMinMaskCoverage(options?: RegionGridOptions): number {
  const coverage = options?.minMaskCoverage;
  if (typeof coverage !== "number" || !Number.isFinite(coverage)) {
    return DEFAULT_MIN_MASK_COVERAGE;
  }
  return Math.min(1, Math.max(0, coverage));
}

/**
 * True when the frame is usable (positive dimensions and a buffer that
 * covers every pixel).
 */
export function isUsableFrame(frame: RgbaFrame | null | undefined): boolean {
  if (!frame) return false;
  const { width, height, data } = frame;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  return data.length >= width * height * 4;
}

/**
 * Computes the per-region change score of `candidate` against
 * `reference`.
 *
 * Contract:
 * - both frames must have the same dimensions; otherwise the result is
 *   `[]` (nothing measured — the caller treats that as a no-op);
 * - a region's `changedFraction` is the fraction of its pixels whose
 *   largest absolute RGB channel delta exceeds `pixelTolerance`;
 * - regions are returned in row-major order and carry `insideMask: false`
 *   (the mask is applied by {@link computeMaskRegionIds}).
 *
 * Side effects: none — pure function.
 */
export function computeRegionChangeScores(
  reference: RgbaFrame,
  candidate: RgbaFrame,
  options?: RegionGridOptions
): ConservationRegion[] {
  if (!isUsableFrame(reference) || !isUsableFrame(candidate)) return [];
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    return [];
  }

  const { rows, columns } = resolveGrid(options);
  const tolerance = resolvePixelTolerance(options);
  const width = reference.width;
  const height = reference.height;

  const regions: ConservationRegion[] = [];

  for (let row = 0; row < rows; row += 1) {
    const yStart = Math.floor((row * height) / rows);
    const yEnd = Math.max(yStart + 1, Math.floor(((row + 1) * height) / rows));

    for (let column = 0; column < columns; column += 1) {
      const xStart = Math.floor((column * width) / columns);
      const xEnd = Math.max(xStart + 1, Math.floor(((column + 1) * width) / columns));

      let changed = 0;
      let compared = 0;

      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const offset = (y * width + x) * 4;
          const dr = Math.abs(reference.data[offset] - candidate.data[offset]);
          const dg = Math.abs(reference.data[offset + 1] - candidate.data[offset + 1]);
          const db = Math.abs(reference.data[offset + 2] - candidate.data[offset + 2]);
          compared += 1;
          if (Math.max(dr, dg, db) > tolerance) changed += 1;
        }
      }

      regions.push({
        regionId: regionId(row, column),
        changedFraction: compared > 0 ? changed / compared : 0,
        insideMask: false,
      });
    }
  }

  return regions;
}

/**
 * Computes the ids of the grid cells the edit mask covers.
 *
 * The mask uses the editor's white-on-black convention (white = the area
 * to regenerate), classified with the shared
 * {@link import("@/lib/mask-coverage").isMaskedPixel} helper so the gate
 * and the editor agree on what "masked" means.
 *
 * A cell is exempt when at least `minMaskCoverage` of its pixels are
 * masked. Returns `[]` when the mask frame is unusable.
 *
 * Side effects: none — pure function.
 */
export function computeMaskRegionIds(
  mask: RgbaFrame,
  options?: RegionGridOptions
): string[] {
  if (!isUsableFrame(mask)) return [];

  const { rows, columns } = resolveGrid(options);
  const minCoverage = resolveMinMaskCoverage(options);
  const width = mask.width;
  const height = mask.height;

  const ids: string[] = [];

  for (let row = 0; row < rows; row += 1) {
    const yStart = Math.floor((row * height) / rows);
    const yEnd = Math.max(yStart + 1, Math.floor(((row + 1) * height) / rows));

    for (let column = 0; column < columns; column += 1) {
      const xStart = Math.floor((column * width) / columns);
      const xEnd = Math.max(xStart + 1, Math.floor(((column + 1) * width) / columns));

      let masked = 0;
      let compared = 0;

      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const offset = (y * width + x) * 4;
          compared += 1;
          if (
            isMaskedPixel(
              mask.data[offset],
              mask.data[offset + 1],
              mask.data[offset + 2],
              mask.data[offset + 3]
            )
          ) {
            masked += 1;
          }
        }
      }

      if (compared > 0 && masked / compared >= minCoverage) {
        ids.push(regionId(row, column));
      }
    }
  }

  return ids;
}

/** The region-layer measurements handed to the conservation check. */
export interface SceneConservationMeasurements {
  /** Per-region change scores of the pre-edit frame (the reference's baseline). */
  before: ConservationRegion[];
  /** Per-region change scores of the edited frame against the reference. */
  after: ConservationRegion[];
  /** The edit mask's exempt region ids. */
  mask: EditMask;
}

/**
 * Builds the region-layer measurements for one edit.
 *
 * The pre-edit frame IS the reference, so its baseline change score is 0
 * for every region — the check's baseline subtraction is therefore a
 * no-op here and the violation signal is the raw out-of-mask change.
 *
 * Returns `null` when the frames cannot be compared (mismatched or
 * unusable dimensions) — the caller's explicit "not measured" no-op.
 *
 * Side effects: none — pure function.
 */
export function buildSceneConservationMeasurements(params: {
  reference: RgbaFrame;
  candidate: RgbaFrame;
  mask?: RgbaFrame | null;
  options?: RegionGridOptions;
}): SceneConservationMeasurements | null {
  const { reference, candidate, mask, options } = params;
  if (!isUsableFrame(reference) || !isUsableFrame(candidate)) return null;
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    return null;
  }

  const after = computeRegionChangeScores(reference, candidate, options);
  if (after.length === 0) return null;

  const before: ConservationRegion[] = after.map((region) => ({
    regionId: region.regionId,
    changedFraction: 0,
    insideMask: false,
  }));

  const maskRegionIds = mask ? computeMaskRegionIds(mask, options) : [];

  return {
    before,
    after,
    mask: { regionIds: maskRegionIds },
  };
}
