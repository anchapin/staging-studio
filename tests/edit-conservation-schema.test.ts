/**
 * Unit tests for edit-conservation-schema.ts (issue #1467).
 *
 * These pin the wire contract of
 * `POST /api/inpaint/[requestId]/conservation`: every field is optional,
 * the top-level object is strict, and the anti-abuse caps are enforced.
 */

import { describe, expect, it } from "vitest";

import { editConservationRequestSchema } from "@/lib/edit-conservation-schema";

/** Builds a region payload entry. */
function region(index: number) {
  return { regionId: `r${index}`, changedFraction: 0 };
}

describe("editConservationRequestSchema", () => {
  it("accepts an empty body (all-optional contract)", () => {
    const parsed = editConservationRequestSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({});
  });

  it("rejects an unknown top-level key (.strict())", () => {
    const parsed = editConservationRequestSchema.safeParse({ nope: 1 });
    expect(parsed.success).toBe(false);
  });

  it("accepts a fully populated body", () => {
    const parsed = editConservationRequestSchema.safeParse({
      regions: { before: [region(0)], after: [region(0)] },
      detections: {
        before: [{ category: "sofa", confidence: 0.9 }],
        after: [{ category: "sofa", confidence: 0.8 }],
      },
      expectedCounts: [{ category: "sofa", add: 1 }],
      mask: { regionIds: ["r0c0"] },
      tolerance: 0.05,
      maxViolations: 3,
      minConfidence: 0.5,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.mask?.regionIds).toEqual(["r0c0"]);
  });

  it("accepts 512 regions and rejects 513", () => {
    const ok = editConservationRequestSchema.safeParse({
      regions: { before: Array.from({ length: 512 }, (_, i) => region(i)) },
    });
    expect(ok.success).toBe(true);

    const tooMany = editConservationRequestSchema.safeParse({
      regions: { before: Array.from({ length: 513 }, (_, i) => region(i)) },
    });
    expect(tooMany.success).toBe(false);
  });

  it("rejects a changedFraction outside [0, 1]", () => {
    expect(
      editConservationRequestSchema.safeParse({
        regions: { after: [{ regionId: "r0c0", changedFraction: 1.5 }] },
      }).success
    ).toBe(false);
    expect(
      editConservationRequestSchema.safeParse({
        regions: { after: [{ regionId: "r0c0", changedFraction: -0.1 }] },
      }).success
    ).toBe(false);
    expect(
      editConservationRequestSchema.safeParse({
        regions: { after: [{ regionId: "r0c0", changedFraction: 0 }] },
      }).success
    ).toBe(true);
    expect(
      editConservationRequestSchema.safeParse({
        regions: { after: [{ regionId: "r0c0", changedFraction: 1 }] },
      }).success
    ).toBe(true);
  });

  it("rejects an empty regionId", () => {
    expect(
      editConservationRequestSchema.safeParse({
        regions: { after: [{ regionId: "", changedFraction: 0 }] },
      }).success
    ).toBe(false);
  });

  it("rejects a maxViolations above 100", () => {
    expect(editConservationRequestSchema.safeParse({ maxViolations: 100 }).success).toBe(true);
    expect(editConservationRequestSchema.safeParse({ maxViolations: 101 }).success).toBe(false);
  });

  it("pins the current behaviour for an unknown key inside `regions`", () => {
    // `regions` is NOT declared `.strict()`, so an unknown key inside it is
    // stripped rather than rejected (the top-level object is the strict
    // one). Pinned so a future change to this is a deliberate decision.
    const parsed = editConservationRequestSchema.safeParse({
      regions: { before: [], after: [], extra: true },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.regions).not.toHaveProperty("extra");
  });

  it("rejects a non-integer maxViolations and out-of-range tolerances", () => {
    expect(editConservationRequestSchema.safeParse({ maxViolations: 1.5 }).success).toBe(false);
    expect(editConservationRequestSchema.safeParse({ tolerance: -0.1 }).success).toBe(false);
    expect(editConservationRequestSchema.safeParse({ tolerance: 1.1 }).success).toBe(false);
    expect(editConservationRequestSchema.safeParse({ minConfidence: 2 }).success).toBe(false);
  });

  it("rejects a malformed mask payload", () => {
    expect(editConservationRequestSchema.safeParse({ mask: {} }).success).toBe(false);
    expect(editConservationRequestSchema.safeParse({ mask: { regionIds: [""] } }).success).toBe(
      false
    );
    expect(
      editConservationRequestSchema.safeParse({
        mask: { regionIds: Array.from({ length: 513 }, (_, i) => `r${i}`) },
      }).success
    ).toBe(false);
  });

  it("caps the detections and expected counts arrays", () => {
    expect(
      editConservationRequestSchema.safeParse({
        detections: { after: Array.from({ length: 513 }, () => ({ category: "sofa" })) },
      }).success
    ).toBe(false);
    expect(
      editConservationRequestSchema.safeParse({
        expectedCounts: Array.from({ length: 65 }, () => ({ category: "sofa" })),
      }).success
    ).toBe(false);
  });
});
