/**
 * Unit tests for edit-conservation.ts (issue #1446, ABACUS-style slice).
 *
 * These pin the deterministic contract of the ABACUS-style checks
 * (arXiv:2610.28316): object-category counting and scene conservation.
 * The module is pure — no AI SDK, no vision SDK, no I/O — so nothing is
 * mocked here.
 *
 * The advisory contract is pinned too: `evaluateEditConservation` never
 * throws; it returns warnings.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCENE_CONSERVATION_TOLERANCE,
  countByCategory,
  evaluateCountCheck,
  evaluateEditConservation,
  evaluateSceneConservation,
  type ConservationDetection,
  type ConservationRegion,
  type CountCheckDetections,
  type ExpectedCountChange,
} from "@/lib/edit-conservation";

function detection(
  category: string,
  confidence?: number
): ConservationDetection {
  return confidence === undefined ? { category } : { category, confidence };
}

function region(
  regionId: string,
  changedFraction: number,
  insideMask = false
): ConservationRegion {
  return { regionId, changedFraction, insideMask };
}

describe("countByCategory", () => {
  it("counts detections per category", () => {
    const counts = countByCategory([
      detection("sofa"),
      detection("chair"),
      detection("sofa"),
      detection("lamp"),
      detection("sofa"),
    ]);

    expect(counts).toEqual({ sofa: 3, chair: 1, lamp: 1 });
  });

  it("returns an empty object for an empty detection list", () => {
    expect(countByCategory([])).toEqual({});
  });

  it("normalizes category labels (trim + lowercase)", () => {
    const counts = countByCategory([
      detection("  Sofa "),
      detection("SOFA"),
      detection("sofa"),
    ]);

    expect(counts).toEqual({ sofa: 3 });
  });

  it("ignores detections with an empty category label", () => {
    const counts = countByCategory([
      detection(""),
      detection("   "),
      detection("rug"),
    ]);

    expect(counts).toEqual({ rug: 1 });
  });

  it("honours the optional minConfidence floor", () => {
    const counts = countByCategory(
      [detection("sofa", 0.9), detection("sofa", 0.2), detection("sofa")],
      { minConfidence: 0.5 }
    );

    // The low-confidence detection is dropped; the one without a reported
    // confidence is kept (the provider did not report one).
    expect(counts).toEqual({ sofa: 2 });
  });
});

describe("evaluateCountCheck", () => {
  const detections: CountCheckDetections = {
    before: [detection("sofa"), detection("chair")],
    after: [detection("sofa"), detection("chair"), detection("lamp")],
  };

  it("passes when the observed count matches the expected count", () => {
    const expected: ExpectedCountChange[] = [
      { category: "sofa", count: 1 },
      { category: "chair", count: 1 },
      { category: "lamp", count: 1 },
    ];

    const result = evaluateCountCheck(expected, detections);

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checkedCategories).toBe(3);
  });

  it("fails and reports the delta when an object is missing", () => {
    const result = evaluateCountCheck(
      [{ category: "sofa", count: 2 }],
      detections
    );

    expect(result.pass).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      category: "sofa",
      expectedCount: 2,
      actualCount: 1,
      countDelta: -1,
      pass: false,
    });
  });

  it("fails and reports the delta when an extra object appears", () => {
    const result = evaluateCountCheck(
      [{ category: "lamp", count: 2 }],
      detections
    );

    expect(result.pass).toBe(false);
    expect(result.failures[0]).toMatchObject({
      category: "lamp",
      expectedCount: 2,
      actualCount: 1,
      countDelta: -1,
    });
  });

  it("derives the expected count from add/remove when count is absent", () => {
    const result = evaluateCountCheck(
      [{ category: "lamp", add: 1 }],
      detections
    );

    // before = 0 lamps, +1 expected → 1 lamp expected, 1 observed.
    expect(result.pass).toBe(true);
    expect(result.categories[0]).toMatchObject({
      expectedCount: 1,
      actualCount: 1,
      countDelta: 0,
      expectedAdd: 1,
      expectedRemove: 0,
      actualAdd: 1,
      actualRemove: 0,
    });
  });

  it("derives the expected count from a removal", () => {
    const result = evaluateCountCheck(
      [{ category: "chair", remove: 1 }],
      {
        before: [detection("chair"), detection("chair")],
        after: [detection("chair")],
      }
    );

    expect(result.pass).toBe(true);
    expect(result.categories[0]).toMatchObject({
      expectedCount: 1,
      actualCount: 1,
      actualRemove: 1,
    });
  });

  it("fails when the expected removal did not happen", () => {
    const result = evaluateCountCheck(
      [{ category: "chair", remove: 1 }],
      detections
    );

    // One chair existed before; removing it means ZERO chairs are expected
    // after the edit, but one is still there.
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toMatchObject({
      category: "chair",
      expectedCount: 0,
      actualCount: 1,
      countDelta: 1,
      actualRemove: 0,
    });
  });

  it("reports unexpected categories without failing the check", () => {
    const result = evaluateCountCheck(
      [{ category: "sofa", count: 1 }],
      detections
    );

    expect(result.pass).toBe(true);
    expect(result.unexpectedCategories).toEqual(["lamp"]);
  });

  it("passes with empty expectations and empty detections", () => {
    const result = evaluateCountCheck([], { before: [], after: [] });

    expect(result.pass).toBe(true);
    expect(result.checkedCategories).toBe(0);
    expect(result.categories).toEqual([]);
    expect(result.unexpectedCategories).toEqual([]);
  });

  it("skips expectations with an empty category label", () => {
    const result = evaluateCountCheck(
      [{ category: "  ", count: 1 }],
      detections
    );

    expect(result.checkedCategories).toBe(0);
    expect(result.pass).toBe(true);
  });
});

describe("evaluateSceneConservation", () => {
  it("passes when every out-of-mask region is unchanged", () => {
    const result = evaluateSceneConservation(
      [region("wall", 0), region("floor", 0)],
      [region("wall", 0), region("floor", 0)]
    );

    expect(result.pass).toBe(true);
    expect(result.checkedRegions).toBe(2);
    expect(result.conservedRegions).toBe(2);
    expect(result.violations).toEqual([]);
  });

  it("treats a change exactly AT the tolerance as conserved", () => {
    const result = evaluateSceneConservation(
      [region("wall", 0)],
      [region("wall", 0.02)],
      undefined,
      { tolerance: 0.02 }
    );

    expect(result.pass).toBe(true);
    expect(result.conservedRegions).toBe(1);
    expect(result.violations).toEqual([]);
  });

  it("flags a change just above the tolerance", () => {
    const result = evaluateSceneConservation(
      [region("wall", 0)],
      [region("wall", 0.021)],
      undefined,
      { tolerance: 0.02 }
    );

    expect(result.pass).toBe(false);
    expect(result.totalViolations).toBe(1);
    expect(result.violations[0]).toMatchObject({
      regionId: "wall",
      changedFraction: 0.021,
      reason: "changed",
    });
  });

  it("exempts regions inside the mask", () => {
    const result = evaluateSceneConservation(
      [region("sofa-area", 0)],
      [region("sofa-area", 0.9, true)],
      { regionIds: ["sofa-area"] }
    );

    expect(result.pass).toBe(true);
    expect(result.checkedRegions).toBe(0);
  });

  it("exempts a region flagged insideMask without a mask list", () => {
    const result = evaluateSceneConservation(
      [region("sofa-area", 0, true)],
      [region("sofa-area", 0.9, true)]
    );

    expect(result.pass).toBe(true);
    expect(result.checkedRegions).toBe(0);
  });

  it("reports the worst offending regions first", () => {
    const result = evaluateSceneConservation(
      [region("a", 0), region("b", 0), region("c", 0)],
      [region("a", 0.1), region("b", 0.6), region("c", 0.3)]
    );

    expect(result.pass).toBe(false);
    expect(result.violations.map((v) => v.regionId)).toEqual(["b", "c", "a"]);
    expect(result.totalViolations).toBe(3);
    expect(result.checkedRegions).toBe(3);
    expect(result.conservedRegions).toBe(0);
  });

  it("truncates the violation list to maxViolations but keeps the total", () => {
    const result = evaluateSceneConservation(
      [region("a", 0), region("b", 0), region("c", 0)],
      [region("a", 0.1), region("b", 0.6), region("c", 0.3)],
      undefined,
      { maxViolations: 1 }
    );

    expect(result.violations).toHaveLength(1);
    expect(result.totalViolations).toBe(3);
  });

  it("subtracts the before-frame baseline from the effective change", () => {
    const result = evaluateSceneConservation(
      [region("wall", 0.05)],
      [region("wall", 0.06)],
      undefined,
      { tolerance: 0.02 }
    );

    // 0.06 - 0.05 = 0.01 effective change → conserved.
    expect(result.pass).toBe(true);
  });

  it("flags a region that disappeared outside the mask", () => {
    const result = evaluateSceneConservation(
      [region("wall", 0), region("floor", 0)],
      [region("wall", 0)]
    );

    expect(result.pass).toBe(false);
    expect(result.violations[0]).toMatchObject({
      regionId: "floor",
      reason: "missing",
      changedFraction: 1,
    });
  });

  it("does not flag a region that disappeared inside the mask", () => {
    const result = evaluateSceneConservation(
      [region("floor", 0, true)],
      [],
      { regionIds: ["floor"] }
    );

    expect(result.pass).toBe(true);
  });

  it("passes with empty inputs", () => {
    const result = evaluateSceneConservation([], []);

    expect(result.pass).toBe(true);
    expect(result.checkedRegions).toBe(0);
    expect(result.tolerance).toBe(DEFAULT_SCENE_CONSERVATION_TOLERANCE);
  });

  it("clamps the tolerance into [0, 1] and defaults invalid values", () => {
    expect(
      evaluateSceneConservation([], [], undefined, { tolerance: 5 }).tolerance
    ).toBe(1);
    expect(
      evaluateSceneConservation([], [], undefined, { tolerance: -1 }).tolerance
    ).toBe(0);
    expect(
      evaluateSceneConservation([], [], undefined, {
        tolerance: Number.NaN,
      }).tolerance
    ).toBe(DEFAULT_SCENE_CONSERVATION_TOLERANCE);
  });

  it("ignores regions without an id", () => {
    const result = evaluateSceneConservation(
      [{ regionId: "", changedFraction: 0.9 }],
      [{ regionId: "", changedFraction: 0.9 }]
    );

    expect(result.pass).toBe(true);
    expect(result.checkedRegions).toBe(0);
  });
});

describe("evaluateEditConservation", () => {
  it("returns no warnings when both checks pass", () => {
    const result = evaluateEditConservation({
      expectedCounts: [{ category: "sofa", count: 1 }],
      detections: {
        before: [detection("chair")],
        after: [detection("chair"), detection("sofa")],
      },
      regions: {
        before: [region("wall", 0)],
        after: [region("wall", 0)],
      },
      mask: { regionIds: [] },
    });

    expect(result.pass).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.countCheck?.pass).toBe(true);
    expect(result.conservation?.pass).toBe(true);
  });

  it("combines count and conservation warnings", () => {
    const result = evaluateEditConservation({
      expectedCounts: [{ category: "sofa", count: 2 }],
      detections: {
        before: [],
        after: [detection("sofa")],
      },
      regions: {
        before: [region("wall", 0)],
        after: [region("wall", 0.5)],
      },
      tolerance: 0.02,
    });

    expect(result.pass).toBe(false);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('"sofa"');
    expect(result.warnings[1]).toContain('"wall"');
  });

  it("skips the count check when no detections are supplied", () => {
    const result = evaluateEditConservation({
      expectedCounts: [{ category: "sofa", count: 2 }],
    });

    expect(result.countCheck).toBeNull();
    expect(result.conservation).toBeNull();
    expect(result.pass).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("never throws on malformed input", () => {
    const result = evaluateEditConservation({
      expectedCounts: undefined,
      detections: undefined,
      regions: undefined,
    });

    expect(result.pass).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("returns an advisory failure result instead of throwing", () => {
    const broken = {
      get detections(): CountCheckDetections {
        throw new Error("boom");
      },
    } as unknown as Parameters<typeof evaluateEditConservation>[0];

    const result = evaluateEditConservation(broken);

    expect(result.pass).toBe(false);
    expect(result.warnings[0]).toContain("Edit conservation evaluation failed");
  });
});
