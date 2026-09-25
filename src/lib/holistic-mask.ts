/**
 * Holistic full-room mask strategies (issue #190 spike).
 *
 * The staging editor's brush/flood-fill/segment tools build masks for
 * single-object region replacement. The "stage the ENTIRE room" holistic
 * flow needs the opposite: a mask that regenerates most (or all) of the
 * photo in one pass, steered by an aesthetic-derived prompt template
 * (see `holistic-prompt.ts`). This module generates those candidate
 * full-room masks as pure functions so the strategies can be compared
 * empirically (fal.ai runs are operator-executed) before issue #191
 * ships the winner as a one-click editor preset.
 *
 * Output contract: an RGBA byte buffer (`Uint8ClampedArray`, 4 bytes per
 * pixel, alpha always 255) matching what the mask canvas exports via
 * `ImageData`. White = regenerated, black = preserved, grayscale =
 * partial (FLUX.1 Fill blends feathered edges). Callers serialize the
 * buffer to a `data:image/*` PNG — the exact shape `aiMaskUrlSchema`
 * already accepts — so these strategies flow through the existing
 * `POST /api/inpaint` route unchanged. Masks are built at the photo's
 * natural pixel dimensions (the same geometry the canvas export targets),
 * which makes them DPR-independent by construction (#181 semantics).
 *
 * Validation: malformed geometry (non-positive or non-integer
 * dimensions) returns `null`, mirroring `dilateMaskGrid`. Side effects:
 * none — every builder is pure and deterministic.
 */

/** Identifiers for the candidate full-room mask strategies. */
export type HolisticMaskStrategyId = "full-frame" | "feathered-frame" | "wall-band";

/** A generated holistic mask in RGBA byte-buffer form. */
export interface HolisticMaskImage {
  width: number;
  height: number;
  /** RGBA bytes (4 per pixel); alpha is always 255. */
  data: Uint8ClampedArray;
}

/** Options for {@link buildFeatheredFrameMask}. */
export interface FeatheredFrameOptions {
  /**
   * Fraction (0..0.5) of the shorter side reserved for the outer
   * preservation ramp. 0 disables feathering (the mask becomes fully
   * white). Non-finite or negative values are treated as 0.
   */
  featherRatio?: number;
}

/** Options for {@link buildWallBandMask}. */
export interface WallBandOptions {
  /** Fraction (0..0.5) of the height preserved above the band (ceiling strip). */
  topRatio?: number;
  /** Fraction (0..0.5) of the height preserved below the band (floor strip). */
  bottomRatio?: number;
  /** Fraction (0..0.5) of the shorter side used to soften the band edges. */
  featherRatio?: number;
}

/** Default outer-preservation ramp for the feathered-frame strategy (6% of the shorter side). */
export const DEFAULT_FEATHER_RATIO = 0.06;

/** Default ceiling strip preserved by the wall-band strategy (14% of height). */
export const DEFAULT_WALL_BAND_TOP_RATIO = 0.14;

/** Default floor strip preserved by the wall-band strategy (16% of height). */
export const DEFAULT_WALL_BAND_BOTTOM_RATIO = 0.16;

function isValidDims(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0
  );
}

function createMaskImage(width: number, height: number): HolisticMaskImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) {
    data[i] = 255;
  }
  return { width, height, data };
}

function paintValue(mask: HolisticMaskImage, x: number, y: number, value: number): void {
  const o = (y * mask.width + x) * 4;
  mask.data[o] = value;
  mask.data[o + 1] = value;
  mask.data[o + 2] = value;
}

/** Normalizes a ratio knob: non-finite/negative → 0, otherwise clamped to [0, 0.5]. */
function normalizeRatio(ratio: number | undefined): number {
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.min(ratio, 0.5);
}

/**
 * Strategy "full-frame" (issue variant a1/a2 mask): the ENTIRE photo is
 * regenerated. Maximum restaging freedom — and the candidate most at risk
 * of drifting the architecture (walls/windows/floor/ceiling line), which
 * is exactly what the spike's decision rule weighs it against.
 */
export function buildFullFrameMask(
  width: number,
  height: number
): HolisticMaskImage | null {
  if (!isValidDims(width, height)) return null;

  const mask = createMaskImage(width, height);
  for (let i = 0; i < width * height; i++) {
    paintValue(mask, i % width, Math.floor(i / width), 255);
  }
  return mask;
}

/**
 * Strategy "feathered-frame": regenerate everything except a soft ramp at
 * the photo's outer rim (default 6% of the shorter side). The preserved
 * rim locks window/wall/TV edges that sit at the photo boundary — the
 * "TV-frame adherence" concern — while the interior stays fully restaged.
 */
export function buildFeatheredFrameMask(
  width: number,
  height: number,
  options?: FeatheredFrameOptions
): HolisticMaskImage | null {
  if (!isValidDims(width, height)) return null;

  const featherRatio = normalizeRatio(options?.featherRatio ?? DEFAULT_FEATHER_RATIO);
  const featherPx = Math.floor(featherRatio * Math.min(width, height));

  const mask = createMaskImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edgeDistance = Math.min(x, y, width - 1 - x, height - 1 - y);
      const value =
        featherPx <= 0 || edgeDistance >= featherPx
          ? 255
          : Math.round((edgeDistance / featherPx) * 255);
      paintValue(mask, x, y, value);
    }
  }
  return mask;
}

/**
 * Strategy "wall-band": regenerate a full-width horizontal band and keep
 * the ceiling and floor strips (plus optional soft transitions) as
 * anchors, so the ceiling line and floor plane survive the regen — the
 * strongest architecture-fidelity guarantee of the three candidates.
 * Returns `null` when the clamped ratios leave no band pixels at all.
 */
export function buildWallBandMask(
  width: number,
  height: number,
  options?: WallBandOptions
): HolisticMaskImage | null {
  if (!isValidDims(width, height)) return null;

  const topRatio = normalizeRatio(options?.topRatio ?? DEFAULT_WALL_BAND_TOP_RATIO);
  const bottomRatio = normalizeRatio(options?.bottomRatio ?? DEFAULT_WALL_BAND_BOTTOM_RATIO);
  if (topRatio + bottomRatio >= 1) return null;

  const featherRatio = normalizeRatio(options?.featherRatio);
  const featherPx = Math.floor(featherRatio * Math.min(width, height));
  const bandTop = Math.floor(topRatio * height);
  const bandBottom = height - Math.floor(bottomRatio * height); // exclusive
  if (bandTop >= bandBottom) return null;

  const mask = createMaskImage(width, height);
  for (let y = 0; y < height; y++) {
    // Distance from the nearest band edge (negative = outside the band).
    const d = Math.min(y - bandTop, bandBottom - 1 - y);
    const value =
      d < 0
        ? 0
        : featherPx <= 0 || d >= featherPx
          ? 255
          : Math.round((d / featherPx) * 255);
    for (let x = 0; x < width; x++) {
      paintValue(mask, x, y, value);
    }
  }
  return mask;
}

/** One selectable full-room mask strategy (the spike's candidate list). */
export interface HolisticMaskStrategy {
  id: HolisticMaskStrategyId;
  label: string;
  description: string;
  build: (width: number, height: number) => HolisticMaskImage | null;
}

/** The candidate strategies in spike-report order (issue #190). */
export const HOLISTIC_MASK_STRATEGIES: readonly HolisticMaskStrategy[] = [
  {
    id: "full-frame",
    label: "Full frame",
    description:
      "Regenerate the entire photo (variants a1/a2). Maximum restaging freedom; highest architecture-drift risk.",
    build: buildFullFrameMask,
  },
  {
    id: "feathered-frame",
    label: "Feathered frame",
    description:
      "Regenerate everything except a soft outer rim, locking window/TV/wall edges at the photo boundary (TV-frame adherence).",
    build: (width, height) => buildFeatheredFrameMask(width, height),
  },
  {
    id: "wall-band",
    label: "Wall band",
    description:
      "Regenerate a full-width band; ceiling and floor strips stay anchored so the ceiling line and floor plane survive.",
    build: (width, height) => buildWallBandMask(width, height),
  },
];

/**
 * Pre-registered default winner (issue #190): `wall-band`. The issue's
 * decision rule — "architecture fidelity outranks magic" — favors the
 * strategy that hard-anchors the ceiling line and floor plane. The
 * operator's empirical verdicts on the real fal.ai runs may overturn
 * this; #191 swaps the constant (this one line) to ship the confirmed
 * winner as the one-click preset.
 */
export const DEFAULT_HOLISTIC_MASK_STRATEGY_ID: HolisticMaskStrategyId = "wall-band";

/** Resolves a strategy by id; `null` for unknown ids. */
export function getHolisticMaskStrategy(
  id: string
): HolisticMaskStrategy | null {
  return HOLISTIC_MASK_STRATEGIES.find((strategy) => strategy.id === id) ?? null;
}
