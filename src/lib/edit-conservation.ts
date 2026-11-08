/**
 * ABACUS-style edit conservation checks for the staging quality gate
 * (issue #1446, scoped slice).
 *
 * PROVENANCE: the ABACUS benchmark (arXiv:2610.28316) evaluates editing
 * pipelines without an LLM judge by asking two deterministic questions of
 * every edited frame:
 *   1. OBJECT COUNTING — did the edit add/remove exactly the objects the
 *      instruction asked for?
 *   2. SCENE CONSERVATION — is everything OUTSIDE the intended change
 *      region preserved?
 * This module implements that pair of checks as pure functions over
 * caller-supplied measurements. It deliberately does NOT import a vision
 * SDK, an image decoder, or an LLM: the caller supplies detections and
 * per-region change scores, and this module only does the deterministic
 * comparison, so the checks are reproducible and free.
 *
 * CONTRACT — ADVISORY ONLY, like `lib/inpaint-quality-gate.ts` (issue
 * #600): the result is a set of warnings. Nothing in this module can
 * fail, block, or reject a submission, and `evaluateEditConservation`
 * never throws (it returns an advisory failure result instead).
 *
 * The existing LLM quality gate stays the primary signal; this module is
 * the deterministic complement for the checks a judge-free benchmark can
 * make without spend. The DCR-SAM / QK-Edit evaluations of the same
 * issue are out of scope here: they need model benchmarks that cannot be
 * run in this repo.
 *
 * Side effects: none — every exported function is pure.
 */

/**
 * Minimal structural detection type: a category label plus an optional
 * confidence. Deliberately NOT a vision-SDK type — callers adapt their
 * provider payloads into this shape, so this module stays dependency-free
 * and unit-testable.
 */
export interface ConservationDetection {
  /** Object category label, e.g. "sofa". */
  category: string;
  /** Optional provider confidence in [0, 1] (used only by the optional filter). */
  confidence?: number;
}

/** Options for {@link countByCategory}. */
export interface DetectionCountOptions {
  /**
   * When set, detections whose confidence is below this threshold are not
   * counted. Detections without a confidence are always counted (the
   * provider did not report one).
   */
  minConfidence?: number;
}

/** Counts per normalized category label. */
export interface CategoryCounts {
  [category: string]: number;
}

/**
 * Counts detected objects per category.
 *
 * Category labels are normalized by trimming whitespace and lowercasing,
 * so " Sofa " and "sofa" count as one category. Labels that are empty
 * after trimming are ignored (nothing to count them under).
 *
 * Side effects: none — pure function.
 */
export function countByCategory(
  detections: readonly ConservationDetection[],
  options?: DetectionCountOptions
): CategoryCounts {
  const counts: CategoryCounts = {};
  const minConfidence = options?.minConfidence;

  for (const detection of detections) {
    const category = normalizeCategory(detection?.category);
    if (!category) continue;
    if (
      minConfidence !== undefined &&
      typeof detection.confidence === "number" &&
      Number.isFinite(detection.confidence) &&
      detection.confidence < minConfidence
    ) {
      continue;
    }
    counts[category] = (counts[category] ?? 0) + 1;
  }

  return counts;
}

/**
 * Expected per-category object-count outcome of an edit.
 *
 * - `count` — the expected number of objects of this category in the
 *   EDITED frame. When given, it is authoritative.
 * - `add` / `remove` — the expected net increase / decrease relative to
 *   the BEFORE frame. Used to derive `count` when `count` is absent:
 *   `expected = beforeCount + add - remove`.
 */
export interface ExpectedCountChange {
  /** Category label (normalized the same way as detections). */
  category: string;
  /** Expected absolute count in the edited frame. */
  count?: number;
  /** Expected number of objects of this category added by the edit. */
  add?: number;
  /** Expected number of objects of this category removed by the edit. */
  remove?: number;
}

/** The before/after detection lists a count check compares. */
export interface CountCheckDetections {
  /** Detections in the pre-edit frame. */
  before: readonly ConservationDetection[];
  /** Detections in the edited frame. */
  after: readonly ConservationDetection[];
}

/** Per-category outcome of the object-count check. */
export interface CategoryCountResult {
  /** Normalized category label. */
  category: string;
  /** Expected count in the edited frame (derived when only add/remove given). */
  expectedCount: number;
  /** Count observed in the edited frame. */
  actualCount: number;
  /** `actualCount - expectedCount` — negative means too few objects. */
  countDelta: number;
  /** Expected net additions (as declared by the caller). */
  expectedAdd: number;
  /** Expected net removals (as declared by the caller). */
  expectedRemove: number;
  /** Net additions actually observed between before and after. */
  actualAdd: number;
  /** Net removals actually observed between before and after. */
  actualRemove: number;
  /** True when `actualCount === expectedCount`. */
  pass: boolean;
}

/** Aggregate result of the object-count check. */
export interface CountCheckResult {
  /** True when every expected category matched and no check errored. */
  pass: boolean;
  /** Number of expected categories evaluated. */
  checkedCategories: number;
  /** Per-category results, in the order the expectations were declared. */
  categories: CategoryCountResult[];
  /** Only the failing categories (subset of `categories`). */
  failures: CategoryCountResult[];
  /**
   * Categories present in the edited frame that the caller did not
   * expect. Reported as advisory information only — an expectation list
   * need not be exhaustive, so this never fails the check on its own.
   */
  unexpectedCategories: string[];
}

/**
 * Compares expected per-category add/remove counts against detections.
 *
 * The check is count-based: for every expected category the expected count
 * in the edited frame is derived (`count`, else
 * `beforeCount + add - remove`) and compared with the observed count in
 * the edited frame. `actualAdd` / `actualRemove` are reported as
 * information.
 *
 * LIMITATION (inherent to counting, documented so callers are not
 * surprised): a replacement edit (one chair swapped for another) leaves
 * the count unchanged and therefore cannot be distinguished from "no
 * edit" by counting alone.
 *
 * Side effects: none — pure function.
 */
export function evaluateCountCheck(
  expected: readonly ExpectedCountChange[],
  detections: CountCheckDetections,
  options?: DetectionCountOptions
): CountCheckResult {
  const beforeCounts = countByCategory(detections.before ?? [], options);
  const afterCounts = countByCategory(detections.after ?? [], options);

  const categories: CategoryCountResult[] = [];
  const expectedCategories = new Set<string>();

  for (const expectation of expected ?? []) {
    const category = normalizeCategory(expectation?.category);
    if (!category) continue;
    expectedCategories.add(category);

    const beforeCount = beforeCounts[category] ?? 0;
    const expectedAdd = clampCount(expectation.add);
    const expectedRemove = clampCount(expectation.remove);
    const explicitCount = expectation.count;
    const expectedCount =
      typeof explicitCount === "number" && Number.isFinite(explicitCount)
        ? Math.max(0, Math.trunc(explicitCount))
        : Math.max(0, beforeCount + expectedAdd - expectedRemove);

    const actualCount = afterCounts[category] ?? 0;
    const countDelta = actualCount - expectedCount;

    categories.push({
      category,
      expectedCount,
      actualCount,
      countDelta,
      expectedAdd,
      expectedRemove,
      actualAdd: Math.max(0, actualCount - beforeCount),
      actualRemove: Math.max(0, beforeCount - actualCount),
      pass: countDelta === 0,
    });
  }

  const failures = categories.filter((result) => !result.pass);
  // Only categories whose count GREW are "unexpected": an expectation list
  // need not be exhaustive, so a pre-existing object nobody mentioned is
  // not a finding — but a category that gained objects is.
  const unexpectedCategories = Object.keys(afterCounts)
    .filter(
      (category) =>
        !expectedCategories.has(category) &&
        afterCounts[category] > (beforeCounts[category] ?? 0)
    )
    .sort();

  return {
    pass: failures.length === 0,
    checkedCategories: categories.length,
    categories,
    failures,
    unexpectedCategories,
  };
}

/**
 * One measured region of the frame.
 *
 * `changedFraction` is the fraction of the region that differs from the
 * caller's reference image, in [0, 1]. `insideMask` marks regions that
 * fall inside the edit mask — those are allowed to change.
 */
export interface ConservationRegion {
  /** Stable region identifier, e.g. "wall-left" or "floor". */
  regionId: string;
  /** Fraction of the region that changed, relative to the reference. */
  changedFraction: number;
  /** True when the region lies inside the edit mask. */
  insideMask?: boolean;
}

/** The set of region ids covered by the edit mask. */
export interface EditMask {
  /** Region ids inside the edit mask (changes there are expected). */
  regionIds: readonly string[];
}

/** Options for {@link evaluateSceneConservation}. */
export interface SceneConservationOptions {
  /**
   * Maximum fraction of an out-of-mask region that may change before the
   * region counts as not conserved. Defaults to
   * {@link DEFAULT_SCENE_CONSERVATION_TOLERANCE}. The comparison is
   * inclusive: a region changed exactly AT the tolerance is conserved.
   */
  tolerance?: number;
  /** Maximum number of offending regions to report (worst first). */
  maxViolations?: number;
}

/**
 * Default conservation tolerance: an out-of-mask region may change up to
 * 2% of its area before the conservation check reports it.
 */
export const DEFAULT_SCENE_CONSERVATION_TOLERANCE = 0.02;

/** Default cap on how many offending regions are reported. */
export const DEFAULT_MAX_CONSERVATION_VIOLATIONS = 10;

/** One out-of-mask region that changed beyond the tolerance. */
export interface ConservationViolation {
  /** Region identifier. */
  regionId: string;
  /** Effective change of the region (after minus before baseline). */
  changedFraction: number;
  /** The region's change measured on the before frame (the baseline). */
  baselineChangedFraction: number;
  /** Why the region counts as a violation. */
  reason: "changed" | "missing";
}

/** Aggregate result of the scene-conservation check. */
export interface SceneConservationResult {
  /** True when every out-of-mask region is conserved. */
  pass: boolean;
  /** The tolerance used for the comparison. */
  tolerance: number;
  /** Number of out-of-mask regions evaluated. */
  checkedRegions: number;
  /** Number of out-of-mask regions that stayed within tolerance. */
  conservedRegions: number;
  /** Offending regions, worst first, truncated to `maxViolations`. */
  violations: ConservationViolation[];
  /** Total number of offending regions (before truncation). */
  totalViolations: number;
}

/**
 * Verifies that everything outside the edit mask was preserved.
 *
 * The caller supplies the per-region change scores of the before and the
 * after frame, measured against the same reference image. The EFFECTIVE
 * change of a region is `after.changedFraction - before.changedFraction`
 * (clamped at 0): the before-frame measurement is the region's own
 * baseline, so a region that was already unstable before the edit is not
 * blamed for the edit. A region present before but absent from the after
 * list is treated as fully changed (reason "missing").
 *
 * Regions inside the mask (per the region's own `insideMask` flag or the
 * `mask.regionIds` list) are exempt — changes there are the point of the
 * edit.
 *
 * Side effects: none — pure function.
 */
export function evaluateSceneConservation(
  before: readonly ConservationRegion[],
  after: readonly ConservationRegion[],
  mask?: EditMask,
  options?: SceneConservationOptions
): SceneConservationResult {
  const tolerance = clampTolerance(options?.tolerance);
  const maxViolations =
    typeof options?.maxViolations === "number" &&
    Number.isFinite(options.maxViolations)
      ? Math.max(0, Math.trunc(options.maxViolations))
      : DEFAULT_MAX_CONSERVATION_VIOLATIONS;

  const beforeById = indexRegions(before);
  const afterById = indexRegions(after);
  const maskRegionIds = new Set(mask?.regionIds ?? []);

  const violations: ConservationViolation[] = [];
  let checkedRegions = 0;
  let conservedRegions = 0;

  const consider = (
    regionId: string,
    baseline: number,
    changed: number,
    reason: ConservationViolation["reason"]
  ): void => {
    const insideMask =
      maskRegionIds.has(regionId) ||
      beforeById.get(regionId)?.insideMask === true ||
      afterById.get(regionId)?.insideMask === true;
    if (insideMask) return;

    checkedRegions += 1;
    const effective = Math.max(0, changed - baseline);
    if (effective <= tolerance) {
      conservedRegions += 1;
      return;
    }
    violations.push({
      regionId,
      changedFraction: effective,
      baselineChangedFraction: baseline,
      reason,
    });
  };

  for (const [regionId, region] of afterById) {
    const baseline = beforeById.get(regionId);
    consider(
      regionId,
      baseline ? baseline.changedFraction : 0,
      region.changedFraction,
      "changed"
    );
  }

  for (const [regionId, region] of beforeById) {
    if (afterById.has(regionId)) continue;
    consider(regionId, region.changedFraction, 1, "missing");
  }

  violations.sort((a, b) => b.changedFraction - a.changedFraction);

  return {
    pass: violations.length === 0,
    tolerance,
    checkedRegions,
    conservedRegions,
    violations: violations.slice(0, maxViolations),
    totalViolations: violations.length,
  };
}

/** Inputs for {@link evaluateEditConservation}. */
export interface EditConservationParams {
  /** Expected per-category count changes (may be omitted). */
  expectedCounts?: readonly ExpectedCountChange[];
  /** Before/after detections for the count check (may be omitted). */
  detections?: CountCheckDetections;
  /** Before/after per-region change measurements (may be omitted). */
  regions?: {
    before: readonly ConservationRegion[];
    after: readonly ConservationRegion[];
  };
  /** The edit mask (may be omitted). */
  mask?: EditMask;
  /** Conservation tolerance (defaults to 2%). */
  tolerance?: number;
  /** Cap on reported conservation violations. */
  maxViolations?: number;
  /** Optional detection confidence floor for the count check. */
  minConfidence?: number;
}

/**
 * The advisory result of the ABACUS-style checks.
 *
 * Shaped like the existing LLM gate's conventions: a `warnings` array of
 * human-readable strings, empty when everything passes. The structured
 * `countCheck` / `conservation` payloads are exposed so a UI can show
 * details without re-deriving them.
 */
export interface EditConservationResult {
  /** True when both checks passed. */
  pass: boolean;
  /** Advisory warnings; empty when everything passes. */
  warnings: string[];
  /** The object-count check result, or null when it was not run. */
  countCheck: CountCheckResult | null;
  /** The scene-conservation check result, or null when it was not run. */
  conservation: SceneConservationResult | null;
}

/**
 * Runs both ABACUS-style checks and returns one advisory result.
 *
 * Neither check is required: a missing `detections` payload skips the
 * count check, a missing `regions` payload skips the conservation check,
 * and the corresponding structured result is `null` in that case.
 *
 * NEVER THROWS: any unexpected input shape is reported as a single
 * advisory warning ("edit conservation evaluation failed: ...") rather
 * than an exception, so a caller on the submission path cannot be broken
 * by it.
 *
 * Side effects: none — pure function.
 */
export function evaluateEditConservation(
  params: EditConservationParams
): EditConservationResult {
  try {
    const warnings: string[] = [];
    let countCheck: CountCheckResult | null = null;
    let conservation: SceneConservationResult | null = null;

    if (params?.detections) {
      countCheck = evaluateCountCheck(
        params.expectedCounts ?? [],
        params.detections,
        { minConfidence: params.minConfidence }
      );
      for (const failure of countCheck.failures) {
        warnings.push(
          `Object count check failed for "${failure.category}": expected ${failure.expectedCount}, found ${failure.actualCount} (delta ${failure.countDelta}).`
        );
      }
      for (const category of countCheck.unexpectedCategories) {
        warnings.push(
          `Object count check noticed an unexpected category "${category}" in the edited frame.`
        );
      }
    }

    if (params?.regions) {
      conservation = evaluateSceneConservation(
        params.regions.before ?? [],
        params.regions.after ?? [],
        params.mask,
        {
          tolerance: params.tolerance,
          maxViolations: params.maxViolations,
        }
      );
      for (const violation of conservation.violations) {
        warnings.push(
          violation.reason === "missing"
            ? `Scene conservation failed: region "${violation.regionId}" disappeared outside the edit mask.`
            : `Scene conservation failed: region "${violation.regionId}" changed ${formatPercent(
                violation.changedFraction
              )} outside the edit mask (tolerance ${formatPercent(
                conservation.tolerance
              )}).`
        );
      }
    }

    return {
      pass: warnings.length === 0,
      warnings,
      countCheck,
      conservation,
    };
  } catch (error) {
    return {
      pass: false,
      warnings: [
        `Edit conservation evaluation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
      countCheck: null,
      conservation: null,
    };
  }
}

/** Normalizes a category label: trimmed, lowercased, "" when empty. */
function normalizeCategory(category: string | undefined): string {
  if (typeof category !== "string") return "";
  return category.trim().toLowerCase();
}

/** Clamps a count expectation to a non-negative integer (0 when invalid). */
function clampCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/** Clamps a tolerance to a non-negative number in [0, 1]. */
function clampTolerance(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SCENE_CONSERVATION_TOLERANCE;
  }
  return Math.min(1, Math.max(0, value));
}

/** Indexes regions by id, keeping the first occurrence of each id. */
function indexRegions(
  regions: readonly ConservationRegion[]
): Map<string, ConservationRegion> {
  const index = new Map<string, ConservationRegion>();
  for (const region of regions ?? []) {
    const regionId = typeof region?.regionId === "string" ? region.regionId : "";
    if (!regionId || index.has(regionId)) continue;
    index.set(regionId, {
      regionId,
      changedFraction: clampFraction(region.changedFraction),
      insideMask: region.insideMask === true,
    });
  }
  return index;
}

/** Clamps a change fraction into [0, 1]; invalid values count as 0. */
function clampFraction(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Formats a fraction as a percentage string with one decimal. */
function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
