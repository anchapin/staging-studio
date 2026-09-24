import { describe, expect, it } from "vitest";

import {
  generatedCopySchema,
  roomCopyEditSchema,
} from "@/lib/room-copy-edit-schema";

const VALID_ITEM = {
  item: "Re-caulk bathroom tile",
  category: "Minor Repair",
  priority: "High",
} as const;

describe("roomCopyEditSchema", () => {
  it("accepts a body with a single edited prose field (partial autosave payload)", () => {
    const result = roomCopyEditSchema.safeParse({
      observedChallenge: "Narrow doorway limits furniture flow.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a full four-field edit body", () => {
    const result = roomCopyEditSchema.safeParse({
      observedChallenge: "Dark north-facing living room.",
      recommendation: "Layer warm lighting and lighter textiles.",
      buyerPsychology: "Empty nesters read brightness as low upkeep.",
      checklistItems: [VALID_ITEM],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an edited checklistItems array (row text/priority edits and deletes)", () => {
    const result = roomCopyEditSchema.safeParse({
      checklistItems: [VALID_ITEM, { ...VALID_ITEM, priority: "Standard" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.checklistItems).toHaveLength(2);
    }
  });

  it("rejects a prose field over the 2000-character cap", () => {
    const result = roomCopyEditSchema.safeParse({
      recommendation: "x".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an entirely empty body (an autosave must carry at least one field)", () => {
    expect(roomCopyEditSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown keys (strict object — only the four editable fields)", () => {
    expect(
      roomCopyEditSchema.safeParse({
        observedChallenge: "ok",
        selectedVariantIndex: 0,
      }).success
    ).toBe(false);
  });

  it("rejects a checklist item with an invalid priority", () => {
    expect(
      roomCopyEditSchema.safeParse({
        checklistItems: [{ ...VALID_ITEM, priority: "Urgent" }],
      }).success
    ).toBe(false);
  });
});

describe("generatedCopySchema", () => {
  const VALID_COPY = {
    observedChallenge: "Narrow galley kitchen reads as cramped.",
    recommendation: "Clear counters and style one open stretch.",
    buyerPsychology: "Buyers gauge counter space as prep potential.",
    checklist: [VALID_ITEM],
  } as const;

  it("accepts a well-formed full generated-copy payload", () => {
    const result = generatedCopySchema.safeParse(VALID_COPY);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.checklist).toHaveLength(1);
    }
  });

  it("rejects a prose field over the 2000-character cap", () => {
    expect(
      generatedCopySchema.safeParse({
        ...VALID_COPY,
        observedChallenge: "x".repeat(2001),
      }).success
    ).toBe(false);
    expect(
      generatedCopySchema.safeParse({
        ...VALID_COPY,
        buyerPsychology: "x".repeat(2001),
      }).success
    ).toBe(false);
  });

  it("rejects an empty prose field", () => {
    expect(
      generatedCopySchema.safeParse({
        ...VALID_COPY,
        recommendation: "",
      }).success
    ).toBe(false);
  });

  it("rejects malformed checklist JSON (item with a bad category)", () => {
    expect(
      generatedCopySchema.safeParse({
        ...VALID_COPY,
        checklist: [{ ...VALID_ITEM, category: "Not A Category" }],
      }).success
    ).toBe(false);
  });

  it("rejects malformed checklist JSON (non-array checklist)", () => {
    expect(
      generatedCopySchema.safeParse({
        ...VALID_COPY,
        checklist: { item: "not an array" },
      }).success
    ).toBe(false);
  });

  it("rejects a partial payload (all four fields are required)", () => {
    expect(
      generatedCopySchema.safeParse({
        observedChallenge: "ok",
        recommendation: "ok",
        buyerPsychology: "ok",
      }).success
    ).toBe(false);
  });

  it("rejects unknown keys (strict object — only the four copy fields)", () => {
    expect(
      generatedCopySchema.safeParse({
        ...VALID_COPY,
        selectedVariantIndex: 0,
      }).success
    ).toBe(false);
  });
});
