import { describe, expect, it } from "vitest";

import {
  SELECTION_LOG_EDITED_LABEL_MAX,
  selectionLogSchema,
} from "@/lib/selection-log-schema";

describe("selectionLogSchema", () => {
  const validEvent = {
    roomId: "room_123",
    concept: "sofa",
    instanceIndex: 0,
    score: 0.87,
  };

  it("accepts a minimal event without editedLabel", () => {
    const result = selectionLogSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validEvent);
    }
  });

  it("accepts an event with an editedLabel at the max bound", () => {
    const result = selectionLogSchema.safeParse({
      ...validEvent,
      editedLabel: "a".repeat(SELECTION_LOG_EDITED_LABEL_MAX),
    });
    expect(result.success).toBe(true);
  });

  it("trims editedLabel before enforcing the bound", () => {
    const result = selectionLogSchema.safeParse({
      ...validEvent,
      editedLabel: `  ${"a".repeat(SELECTION_LOG_EDITED_LABEL_MAX)}  `,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.editedLabel).toBe("a".repeat(SELECTION_LOG_EDITED_LABEL_MAX));
    }
  });

  it("rejects an editedLabel over the max bound", () => {
    expect(
      selectionLogSchema.safeParse({
        ...validEvent,
        editedLabel: "a".repeat(SELECTION_LOG_EDITED_LABEL_MAX + 1),
      }).success
    ).toBe(false);
  });

  it("rejects a blank editedLabel", () => {
    expect(
      selectionLogSchema.safeParse({ ...validEvent, editedLabel: "   " }).success
    ).toBe(false);
  });

  it("rejects a non-string editedLabel", () => {
    expect(
      selectionLogSchema.safeParse({ ...validEvent, editedLabel: 42 }).success
    ).toBe(false);
  });

  it("rejects an empty or missing roomId", () => {
    expect(selectionLogSchema.safeParse({ ...validEvent, roomId: "" }).success).toBe(false);
    expect(
      selectionLogSchema.safeParse({
        concept: validEvent.concept,
        instanceIndex: validEvent.instanceIndex,
        score: validEvent.score,
      }).success
    ).toBe(false);
  });

  describe("concept bounds (mirrors segmentConceptSchema)", () => {
    it("rejects a concept over 30 chars", () => {
      expect(
        selectionLogSchema.safeParse({ ...validEvent, concept: "a".repeat(31) })
          .success
      ).toBe(false);
    });

    it("rejects an empty concept", () => {
      expect(
        selectionLogSchema.safeParse({ ...validEvent, concept: "  " }).success
      ).toBe(false);
    });

    it("rejects sentences, commas, and digits (charset rule)", () => {
      expect(
        selectionLogSchema.safeParse({ ...validEvent, concept: "A comfy sofa" })
          .success
      ).toBe(false);
      expect(
        selectionLogSchema.safeParse({ ...validEvent, concept: "sofa, chair" })
          .success
      ).toBe(false);
      expect(
        selectionLogSchema.safeParse({ ...validEvent, concept: "sofa2" }).success
      ).toBe(false);
    });

    it("trims and accepts a valid multi-word concept", () => {
      const result = selectionLogSchema.safeParse({
        ...validEvent,
        concept: " coffee table ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.concept).toBe("coffee table");
      }
    });
  });

  describe("instanceIndex bounds", () => {
    it("rejects a negative index", () => {
      expect(
        selectionLogSchema.safeParse({ ...validEvent, instanceIndex: -1 }).success
      ).toBe(false);
    });

    it("rejects a non-integer index", () => {
      expect(
        selectionLogSchema.safeParse({ ...validEvent, instanceIndex: 1.5 }).success
      ).toBe(false);
    });

    it("rejects a non-number index", () => {
      expect(
        selectionLogSchema.safeParse({ ...validEvent, instanceIndex: "0" }).success
      ).toBe(false);
    });
  });

  describe("score bounds", () => {
    it("accepts integer scores, including zero", () => {
      expect(
        selectionLogSchema.safeParse({ ...validEvent, score: 0 }).success
      ).toBe(true);
    });

    it("rejects NaN", () => {
      expect(
        selectionLogSchema.safeParse({ ...validEvent, score: Number.NaN }).success
      ).toBe(false);
    });

    it("rejects Infinity and -Infinity", () => {
      expect(
        selectionLogSchema.safeParse({ ...validEvent, score: Number.POSITIVE_INFINITY })
          .success
      ).toBe(false);
      expect(
        selectionLogSchema.safeParse({ ...validEvent, score: Number.NEGATIVE_INFINITY })
          .success
      ).toBe(false);
    });

    it("rejects a non-number score", () => {
      expect(
        selectionLogSchema.safeParse({ ...validEvent, score: "0.87" }).success
      ).toBe(false);
    });
  });

  it("rejects unknown keys (strict object)", () => {
    expect(
      selectionLogSchema.safeParse({ ...validEvent, staleClientField: true }).success
    ).toBe(false);
  });
});
