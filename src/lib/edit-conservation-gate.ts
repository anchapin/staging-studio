/**
 * Advisory wiring for the ABACUS-style edit-conservation checks
 * (issue #1446, wiring slice).
 *
 * This module is the QA-path adapter around the pure checks in
 * `src/lib/edit-conservation.ts`. It exists so the inpaint QA path has
 * ONE entry point with ONE contract:
 *
 *   - ADVISORY ONLY. The result is a list of warning strings — the same
 *     `qualityWarnings` channel the existing LLM quality gate uses
 *     (`src/lib/inpaint-quality-gate.ts`). Nothing here can fail, block,
 *     reject, or downgrade an edit: a caller can ignore the warnings
 *     entirely and the edit's outcome is unchanged.
 *   - NEVER THROWS. `evaluateEditConservation` already swallows its own
 *     errors, and this wrapper additionally catches anything unexpected so
 *     a QA path can never be broken by the gate.
 *   - NO DATA ⇒ NO-OP. A caller that has no measurements gets
 *     `{ qualityWarnings: [], pass: true, evaluated: false }` — no
 *     warnings are invented and no check is claimed to have run.
 *
 * CHECK SELECTION (why a check is skipped):
 *
 *   - The object-count check runs only when BOTH the expected counts and
 *     the before/after detections are present. Without expected counts
 *     the check could only report "unexpected category" for every object
 *     in the frame, which is noise, not signal — so the gate treats the
 *     count check as NOT MEASURED instead (the repo has no counting
 *     source for staged outputs yet; see
 *     `docs/1446-abacus-dcr-sam-qk-edit-evaluation.md` §3.5).
 *   - The scene-conservation check runs only when before/after per-region
 *     change scores are present.
 *
 * Side effects: none — every exported function is pure.
 */

import {
  evaluateEditConservation,
  type ConservationDetection,
  type ConservationRegion,
  type EditConservationResult,
  type EditMask,
  type ExpectedCountChange,
} from "@/lib/edit-conservation";

/**
 * The measurements a QA call site can supply.
 *
 * Every field is optional: a call site that has no detections or no
 * region change scores simply omits them and the corresponding check is
 * skipped (see the module doc).
 */
export interface EditConservationMeasurements {
  /** Requested per-category count changes (the edit's own instruction). */
  expectedCounts?: readonly ExpectedCountChange[];
  /** Before/after detections for the object-count check. */
  detections?: {
    before: readonly ConservationDetection[];
    after: readonly ConservationDetection[];
  };
  /** Before/after per-region change measurements for the conservation check. */
  regions?: {
    before: readonly ConservationRegion[];
    after: readonly ConservationRegion[];
  };
  /** The edit mask (region ids inside the mask are exempt). */
  mask?: EditMask;
  /** Conservation tolerance (defaults to the module's 2%). */
  tolerance?: number;
  /** Cap on reported conservation violations. */
  maxViolations?: number;
  /** Optional detection confidence floor for the count check. */
  minConfidence?: number;
}

/**
 * The advisory outcome of the gate.
 *
 * Shaped like the existing LLM gate's result: a `qualityWarnings` array
 * of human-readable strings, empty when nothing objectionable was found.
 */
export interface EditConservationGateResult {
  /** Advisory warnings; empty when everything passes (or nothing was measured). */
  qualityWarnings: string[];
  /** True when no warning was raised. */
  pass: boolean;
  /**
   * False when there was nothing to measure — the explicit no-op case.
   * A caller can use it to tell "checked and clean" from "not checked".
   */
  evaluated: boolean;
  /** The structured result, or null when no check ran / the gate failed. */
  result: EditConservationResult | null;
}

/**
 * True when the object-count check has everything it needs.
 *
 * Side effects: none — pure function.
 */
export function hasCountCheckInputs(
  measurements: EditConservationMeasurements | null | undefined
): boolean {
  if (!measurements) return false;
  const expected = measurements.expectedCounts;
  if (!Array.isArray(expected) || expected.length === 0) return false;
  const detections = measurements.detections;
  if (!detections) return false;
  return Array.isArray(detections.before) || Array.isArray(detections.after);
}

/**
 * True when the scene-conservation check has everything it needs.
 *
 * Side effects: none — pure function.
 */
export function hasConservationInputs(
  measurements: EditConservationMeasurements | null | undefined
): boolean {
  if (!measurements) return false;
  const regions = measurements.regions;
  if (!regions) return false;
  const before = Array.isArray(regions.before) ? regions.before : [];
  const after = Array.isArray(regions.after) ? regions.after : [];
  return before.length > 0 || after.length > 0;
}

/**
 * Runs the ABACUS-style checks over the supplied measurements.
 *
 * Contract (see the module doc):
 * - advisory only — the caller decides what to do with the warnings, and
 *   the edit's outcome never depends on them;
 * - never throws;
 * - no measurements ⇒ no warnings and `evaluated: false`.
 *
 * Side effects: none — pure function.
 */
export function evaluateEditConservationGate(
  measurements?: EditConservationMeasurements | null
): EditConservationGateResult {
  const noop: EditConservationGateResult = {
    qualityWarnings: [],
    pass: true,
    evaluated: false,
    result: null,
  };

  try {
    if (!measurements) return noop;

    const runCountCheck = hasCountCheckInputs(measurements);
    const runConservationCheck = hasConservationInputs(measurements);
    if (!runCountCheck && !runConservationCheck) return noop;

    const result = evaluateEditConservation({
      // The count check is skipped unless it has expected counts AND
      // detections — see the module doc.
      ...(runCountCheck
        ? {
            expectedCounts: measurements.expectedCounts ?? [],
            detections: measurements.detections as {
              before: readonly ConservationDetection[];
              after: readonly ConservationDetection[];
            },
          }
        : {}),
      ...(runConservationCheck
        ? {
            regions: measurements.regions as {
              before: readonly ConservationRegion[];
              after: readonly ConservationRegion[];
            },
          }
        : {}),
      ...(measurements.mask ? { mask: measurements.mask } : {}),
      ...(typeof measurements.tolerance === "number"
        ? { tolerance: measurements.tolerance }
        : {}),
      ...(typeof measurements.maxViolations === "number"
        ? { maxViolations: measurements.maxViolations }
        : {}),
      ...(typeof measurements.minConfidence === "number"
        ? { minConfidence: measurements.minConfidence }
        : {}),
    });

    const qualityWarnings = Array.isArray(result.warnings) ? result.warnings : [];

    return {
      qualityWarnings,
      pass: qualityWarnings.length === 0,
      evaluated: true,
      result,
    };
  } catch {
    // A QA gate must never be the reason an edit fails: swallow anything
    // unexpected and report "nothing measured".
    return noop;
  }
}
