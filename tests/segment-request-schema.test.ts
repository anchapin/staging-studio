import { describe, expect, it } from "vitest";

import { furnishingsSegmentRequestSchema } from "@/lib/ai-route-schemas";

describe("furnishingsSegmentRequestSchema", () => {
  const validFurnishingsBody = {
    roomId: "room_123",
    imageUrl: "https://example.supabase.co/storage/v1/object/public/rooms/before-image.png",
  };

  it("accepts a room-scoped detection request without a concept (default is applied route-side)", () => {
    const result = furnishingsSegmentRequestSchema.safeParse(validFurnishingsBody);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validFurnishingsBody);
      expect(result.data.concept).toBeUndefined();
    }
  });

  it("accepts a room-scoped detection request with a concept", () => {
    const result = furnishingsSegmentRequestSchema.safeParse({
      ...validFurnishingsBody,
      concept: "sofa",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.concept).toBe("sofa");
    }
  });

  it("accepts multi-word and hyphenated lowercase concepts and trims whitespace", () => {
    expect(
      furnishingsSegmentRequestSchema.safeParse({ ...validFurnishingsBody, concept: "wall art" })
        .success
    ).toBe(true);
    expect(
      furnishingsSegmentRequestSchema.safeParse({ ...validFurnishingsBody, concept: "mid-century chair" })
        .success
    ).toBe(true);
    const trimmed = furnishingsSegmentRequestSchema.safeParse({
      ...validFurnishingsBody,
      concept: "  sofa  ",
    });
    expect(trimmed.success).toBe(true);
    if (trimmed.success) {
      expect(trimmed.data.concept).toBe("sofa");
    }
  });

  it("accepts a concept at the 30-character boundary and rejects 31", () => {
    const thirty = "a".repeat(30);
    const thirtyOne = "a".repeat(31);
    expect(
      furnishingsSegmentRequestSchema.safeParse({ ...validFurnishingsBody, concept: thirty })
        .success
    ).toBe(true);
    expect(
      furnishingsSegmentRequestSchema.safeParse({ ...validFurnishingsBody, concept: thirtyOne })
        .success
    ).toBe(false);
  });

  it("rejects uppercase, digits, and punctuation (lowercase letters, spaces, hyphens only)", () => {
    expect(
      furnishingsSegmentRequestSchema.safeParse({ ...validFurnishingsBody, concept: "Sofa" })
        .success
    ).toBe(false);
    expect(
      furnishingsSegmentRequestSchema.safeParse({ ...validFurnishingsBody, concept: "sofa2" })
        .success
    ).toBe(false);
    expect(
      furnishingsSegmentRequestSchema.safeParse({ ...validFurnishingsBody, concept: "sofa!" })
        .success
    ).toBe(false);
  });

  it("rejects comma lists and sentence punctuation (SAM 3.1 returns zero masks for multi-term lists)", () => {
    // Issue #223 spike: "furniture, sofa, rug, ..." matched nothing —
    // commas and sentence punctuation are rejected by the charset rule
    // itself, so a malformed concept can never reach a quota-billed call.
    expect(
      furnishingsSegmentRequestSchema.safeParse({
        ...validFurnishingsBody,
        concept: "sofa, rug",
      }).success
    ).toBe(false);
    expect(
      furnishingsSegmentRequestSchema.safeParse({
        ...validFurnishingsBody,
        concept: "all the furniture.",
      }).success
    ).toBe(false);
    expect(
      furnishingsSegmentRequestSchema.safeParse({
        ...validFurnishingsBody,
        concept: "decor and more!",
      }).success
    ).toBe(false);
  });

  it("rejects an empty or whitespace-only concept", () => {
    expect(
      furnishingsSegmentRequestSchema.safeParse({ ...validFurnishingsBody, concept: "" }).success
    ).toBe(false);
    expect(
      furnishingsSegmentRequestSchema.safeParse({ ...validFurnishingsBody, concept: "   " })
        .success
    ).toBe(false);
  });

  it("rejects a non-string concept", () => {
    expect(
      furnishingsSegmentRequestSchema.safeParse({ ...validFurnishingsBody, concept: 42 })
        .success
    ).toBe(false);
  });

  it("rejects a body missing roomId or imageUrl", () => {
    expect(furnishingsSegmentRequestSchema.safeParse({ imageUrl: validFurnishingsBody.imageUrl }).success).toBe(false);
    expect(furnishingsSegmentRequestSchema.safeParse({ roomId: "room_123" }).success).toBe(false);
  });

  it("rejects an empty roomId", () => {
    expect(
      furnishingsSegmentRequestSchema.safeParse({ ...validFurnishingsBody, roomId: "" }).success
    ).toBe(false);
  });

  it("rejects image URLs on non-allowlisted hosts", () => {
    expect(
      furnishingsSegmentRequestSchema.safeParse({
        ...validFurnishingsBody,
        imageUrl: "https://evil.example.com/rooms/before-image.png",
      }).success
    ).toBe(false);
  });

  it("rejects unknown keys (strict object)", () => {
    expect(
      furnishingsSegmentRequestSchema.safeParse({
        ...validFurnishingsBody,
        point: { x: 1, y: 1 },
      }).success
    ).toBe(false);
  });
});
