import { describe, expect, it } from "vitest";

import {
  buildConceptEmptyMessage,
  buildSelectionLoggedEvent,
  CONCEPT_CHIPS,
  DEFAULT_CONCEPT,
  isValidConceptName,
  normalizeConceptInput,
} from "@/lib/concept-chips";

describe("CONCEPT_CHIPS", () => {
  it("leads with the furniture catch-all (the auto-fire default)", () => {
    expect(CONCEPT_CHIPS[0]).toBe("furniture");
    expect(DEFAULT_CONCEPT).toBe("furniture");
  });

  it("carries the expected single-concept taxonomy", () => {
    expect([...CONCEPT_CHIPS]).toEqual([
      "furniture",
      "sofa",
      "chair",
      "table",
      "rug",
      "bed",
      "lamp",
      "artwork",
      "plant",
      "curtains",
      "nightstand",
      "mirror",
      "desk",
      "wardrobe",
      "bookshelf",
    ]);
  });

  it("every chip passes the concept validation by construction", () => {
    for (const chip of CONCEPT_CHIPS) {
      expect(isValidConceptName(chip), `chip "${chip}" must be valid`).toBe(true);
    }
  });
});

describe("isValidConceptName", () => {
  // Mirrors the server's segmentConceptSchema (issue #227) exactly:
  // trim → length 1–30 → ^[a-z -]+$. The cases below pin the same
  // acceptance/rejection boundary so client gating never diverges from
  // what the route would accept.
  it("accepts single lowercase words", () => {
    expect(isValidConceptName("sofa")).toBe(true);
  });

  it("accepts short phrases with spaces and hyphens", () => {
    expect(isValidConceptName("wall art")).toBe(true);
    expect(isValidConceptName("tv-stand")).toBe(true);
  });

  it("accepts values that need trimming (length applies after trim)", () => {
    expect(isValidConceptName("  sofa  ")).toBe(true);
    expect(isValidConceptName(" rug")).toBe(true);
  });

  it("accepts a 30-character trimmed value and rejects 31", () => {
    expect(isValidConceptName("a".repeat(30))).toBe(true);
    expect(isValidConceptName("a".repeat(31))).toBe(false);
    expect(isValidConceptName(` ${"a".repeat(30)} `)).toBe(true);
  });

  it("rejects empty and whitespace-only values", () => {
    expect(isValidConceptName("")).toBe(false);
    expect(isValidConceptName("   ")).toBe(false);
  });

  it("rejects uppercase, digits, and punctuation", () => {
    expect(isValidConceptName("Sofa")).toBe(false);
    expect(isValidConceptName("sofa1")).toBe(false);
    expect(isValidConceptName("sofa, chair")).toBe(false);
    expect(isValidConceptName("sofa!")).toBe(false);
    expect(isValidConceptName("all furniture and decor in the room")).toBe(false); // sentence + >30
  });

  it("allows multi-word phrases beyond two words (no word-count cap)", () => {
    expect(isValidConceptName("small round side table")).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(isValidConceptName(null)).toBe(false);
    expect(isValidConceptName(42)).toBe(false);
    expect(isValidConceptName(undefined)).toBe(false);
  });
});

describe("normalizeConceptInput", () => {
  // Issue #249: capitals are the common case the free-text field should
  // forgive — normalization runs BEFORE validation, but validation itself
  // (the server-schema mirror) stays strict.
  it("lowercases and trims so capitalized input passes validation", () => {
    expect(normalizeConceptInput("Sofa")).toBe("sofa");
    expect(isValidConceptName(normalizeConceptInput("Sofa"))).toBe(true);
  });

  it("normalizes multi-word capitalized phrases", () => {
    expect(normalizeConceptInput("  Wall Art  ")).toBe("wall art");
    expect(isValidConceptName(normalizeConceptInput("Wall Art"))).toBe(true);
  });

  it("passes already-lowercase values through unchanged", () => {
    expect(normalizeConceptInput("wall art")).toBe("wall art");
    expect(normalizeConceptInput("  rug  ")).toBe("rug");
  });

  it("still fails validation when normalization cannot fix the value", () => {
    expect(isValidConceptName(normalizeConceptInput("Sofa1"))).toBe(false);
    expect(isValidConceptName(normalizeConceptInput("Sofa, Chair"))).toBe(false);
    expect(isValidConceptName(normalizeConceptInput("   "))).toBe(false);
  });
});

describe("buildConceptEmptyMessage", () => {
  // Issue #249: the brush is named FIRST — when detection finds nothing,
  // the brush is the reliable fallback and must not read as an afterthought.
  it("suggests the brush first, then the furniture catch-all, for other concepts", () => {
    expect(buildConceptEmptyMessage("sofa")).toBe(
      "no sofa found — paint the area with the brush, or try 'furniture'"
    );
  });

  it("suggests the brush first, then other concepts, when the default found nothing", () => {
    expect(buildConceptEmptyMessage("furniture")).toBe(
      "no furniture found — paint the area with the brush, or try another concept"
    );
  });

  it("falls back to the default for an unvalidated concept", () => {
    expect(buildConceptEmptyMessage("")).toBe(
      "no furniture found — paint the area with the brush, or try another concept"
    );
  });
});

describe("buildSelectionLoggedEvent", () => {
  it("builds the W3 corpus shape with a numeric score", () => {
    expect(
      buildSelectionLoggedEvent({
        roomId: "room-1",
        concept: "sofa",
        instanceIndex: 2,
        score: 0.87,
      })
    ).toEqual({
      event: "selection_logged",
      roomId: "room-1",
      concept: "sofa",
      instanceIndex: 2,
      score: 0.87,
    });
  });

  it("normalizes missing or non-finite scores to null", () => {
    expect(buildSelectionLoggedEvent({ roomId: "r", concept: "rug", instanceIndex: 0 }).score).toBeNull();
    expect(
      buildSelectionLoggedEvent({ roomId: "r", concept: "rug", instanceIndex: 0, score: null }).score
    ).toBeNull();
    expect(
      buildSelectionLoggedEvent({ roomId: "r", concept: "rug", instanceIndex: 0, score: NaN }).score
    ).toBeNull();
  });

  it("carries editedLabel only when provided (key stays absent otherwise)", () => {
    const without = buildSelectionLoggedEvent({ roomId: "r", concept: "bed", instanceIndex: 1 });
    expect("editedLabel" in without).toBe(false);
    const withLabel = buildSelectionLoggedEvent({
      roomId: "r",
      concept: "bed",
      instanceIndex: 1,
      editedLabel: "Object 2",
    });
    expect(withLabel.editedLabel).toBe("Object 2");
  });
});
