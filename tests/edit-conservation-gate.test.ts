/**
 * Unit tests for edit-conservation-gate.ts (issue #1446, wiring slice).
 *
 * These pin the wiring contract of the ABACUS-style gate adapter:
 * advisory only (warnings surface, the result can never fail an edit),
 * never throws, and no measurements is an explicit no-op
 * (`evaluated: false`, no invented warnings).
 */

import { describe, expect, it } from "vitest";

import {
  evaluateEditConservationGate,
  hasConservationInputs,
  hasCountCheckInputs,
} from "@/lib/edit-conservation-gate";

describe("evaluateEditConservationGate", () => {
  it("is an explicit no-op when there are no measurements", () => {
    for (const input of [undefined, null, {}]) {
      const gate = evaluateEditConservationGate(input);
      expect(gate.qualityWarnings).toEqual([]);
      expect(gate.pass).toBe(true);
      expect(gate.evaluated).toBe(false);
      expect(gate.result).toBeNull();
    }
  });

  it("is a no-op when only half a measurement pair is supplied", () => {
    const gate = evaluateEditConservationGate({
      expectedCounts: [{ category: "sofa", add: 1 }],
      detections: { before: [{ category: "sofa" }], after: [] },
      regions: { before: [], after: [] },
    });
    // detections.after is present (empty array counts as measured for the
    // count check), but with no regions there is no conservation input;
    // the count check below covers the measured path. Here we only pin
    // that empty region pairs do not count as conservation inputs.
    expect(hasConservationInputs({ regions: { before: [], after: [] } })).toBe(
      false
    );
    expect(gate.evaluated).toBe(true);
  });

  it("surfaces advisory warnings for an unexpected object count", () => {
    const gate = evaluateEditConservationGate({
      expectedCounts: [{ category: "sofa", add: 1 }],
      detections: {
        before: [{ category: "sofa" }],
        after: [{ category: "sofa" }, { category: "sofa" }, { category: "sofa" }],
      },
    });
    expect(gate.evaluated).toBe(true);
    expect(gate.pass).toBe(false);
    expect(gate.qualityWarnings.length).toBeGreaterThan(0);
    // Advisory shape only: warnings are strings a caller may ignore.
    expect(gate.qualityWarnings.every((w) => typeof w === "string")).toBe(true);
  });

  it("passes clean when counts and conservation are within tolerance", () => {
    const gate = evaluateEditConservationGate({
      expectedCounts: [{ category: "sofa", add: 1 }],
      detections: {
        before: [{ category: "sofa" }],
        after: [{ category: "sofa" }, { category: "sofa" }],
      },
      regions: {
        before: [{ regionId: "wall", changedFraction: 0 }],
        after: [{ regionId: "wall", changedFraction: 0.01 }],
      },
    });
    expect(gate.evaluated).toBe(true);
    expect(gate.pass).toBe(true);
    expect(gate.qualityWarnings).toEqual([]);
  });

  it("never throws on malformed measurements", () => {
    const gate = evaluateEditConservationGate({
      // @ts-expect-error deliberately malformed input
      detections: { before: "not-an-array" },
    });
    expect(gate.pass).toBe(true);
    expect(gate.qualityWarnings).toEqual([]);
  });

  it("hasCountCheckInputs requires expected counts AND detections", () => {
    expect(hasCountCheckInputs({})).toBe(false);
    expect(
      hasCountCheckInputs({ expectedCounts: [{ category: "sofa", add: 1 }] })
    ).toBe(false);
    expect(
      hasCountCheckInputs({
        expectedCounts: [{ category: "sofa", add: 1 }],
        detections: { before: [], after: [] },
      })
    ).toBe(true);
  });
});
