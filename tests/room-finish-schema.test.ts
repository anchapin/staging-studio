import { describe, expect, it } from "vitest";

import { roomFinishSchema } from "@/lib/room-finish-schema";

const validBody = {
  materialFinishId: "travertine-honed",
  materialFinishDirectives: "warm honed stone, low-sheen, no veining contrast",
  materialFinishConceptLabel: "warm minimal",
};

describe("roomFinishSchema", () => {
  it("accepts a valid payload and preserves the field values", () => {
    const result = roomFinishSchema.safeParse(validBody);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validBody);
    }
  });

  /**
   * The "Clear" UI path submits empty strings for the fields it is clearing,
   * and the schema is responsible for turning those into null before the write.
   */
  it("normalises empty strings to null", () => {
    const result = roomFinishSchema.safeParse({
      materialFinishId: "",
      materialFinishDirectives: "",
      materialFinishConceptLabel: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        materialFinishId: null,
        materialFinishDirectives: null,
        materialFinishConceptLabel: null,
      });
    }
  });

  it.each([
    "materialFinishId",
    "materialFinishDirectives",
    "materialFinishConceptLabel",
  ] as const)("normalises an empty string for %s to null", (field) => {
    const result = roomFinishSchema.safeParse({ ...validBody, [field]: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[field]).toBeNull();
    }
  });

  it("leaves a non-empty string untouched", () => {
    const result = roomFinishSchema.safeParse(validBody);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.materialFinishConceptLabel).toBe("warm minimal");
    }
  });

  /**
   * The reason this schema exists. These three columns are the only ones this
   * route is meant to write; `.strict()` is what stops a crafted payload from
   * riding this path and setting arbitrary persisted columns on the room.
   */
  it("rejects unknown keys so this path cannot write arbitrary columns", () => {
    const result = roomFinishSchema.safeParse({
      ...validBody,
      // A crafted payload trying to reach a column the UI never sends.
      selectedVariantIndex: 1,
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ["userId", "someone-else"],
    ["projectId", "another-project"],
    ["id", "some-id"],
  ])("rejects an injected %s key", (key, value) => {
    const result = roomFinishSchema.safeParse({ ...validBody, [key]: value });
    expect(result.success).toBe(false);
  });

  it("rejects a completely unrelated body", () => {
    const result = roomFinishSchema.safeParse({ notAField: "nope" });
    expect(result.success).toBe(false);
  });

  it.each([
    ["materialFinishId", "x".repeat(65)],
    ["materialFinishDirectives", "x".repeat(2001)],
    ["materialFinishConceptLabel", "x".repeat(201)],
  ] as const)("rejects an over-long %s", (field, value) => {
    const result = roomFinishSchema.safeParse({ ...validBody, [field]: value });
    expect(result.success).toBe(false);
  });

  it.each([
    ["materialFinishId", "x".repeat(64)],
    ["materialFinishDirectives", "x".repeat(2000)],
    ["materialFinishConceptLabel", "x".repeat(200)],
  ] as const)("accepts a %s exactly at the ceiling", (field, value) => {
    const result = roomFinishSchema.safeParse({ ...validBody, [field]: value });
    expect(result.success).toBe(true);
  });

  it("accepts explicit nulls for every field", () => {
    const result = roomFinishSchema.safeParse({
      materialFinishId: null,
      materialFinishDirectives: null,
      materialFinishConceptLabel: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        materialFinishId: null,
        materialFinishDirectives: null,
        materialFinishConceptLabel: null,
      });
    }
  });

  it("accepts a partial payload, leaving omitted fields null", () => {
    const result = roomFinishSchema.safeParse({
      materialFinishConceptLabel: "warm minimal",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.materialFinishConceptLabel).toBe("warm minimal");
      expect(result.data.materialFinishId).toBeNull();
      expect(result.data.materialFinishDirectives).toBeNull();
    }
  });
});