import { describe, expect, it } from "vitest";

import {
  furnishingsSegmentRequestSchema,
  segmentRequestSchema,
} from "@/lib/ai-route-schemas";

const validBody = {
  roomId: "room_123",
  imageUrl: "https://example.supabase.co/storage/v1/object/public/rooms/before-image.png",
  point: { x: 512, y: 384 },
  imageWidth: 1024,
  imageHeight: 768,
};

describe("segmentRequestSchema", () => {
  it("accepts a room-scoped click within the image bounds", () => {
    const result = segmentRequestSchema.safeParse(validBody);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validBody);
    }
  });

  it("accepts points on the image boundary edges", () => {
    const result = segmentRequestSchema.safeParse({
      ...validBody,
      point: { x: 1024, y: 768 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an issue-#202 pre-warm ping (warm: true) with the full click shape", () => {
    const result = segmentRequestSchema.safeParse({ ...validBody, warm: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.warm).toBe(true);
    }
  });

  it("treats warm as an optional flag (absent means a real click)", () => {
    const result = segmentRequestSchema.safeParse(validBody);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.warm).toBeUndefined();
    }
  });

  it("rejects a non-boolean warm flag", () => {
    expect(
      segmentRequestSchema.safeParse({ ...validBody, warm: "yes" }).success
    ).toBe(false);
  });

  it("rejects a body missing roomId", () => {
    expect(
      segmentRequestSchema.safeParse({ ...validBody, roomId: undefined }).success
    ).toBe(false);
  });

  it("rejects an empty roomId", () => {
    expect(segmentRequestSchema.safeParse({ ...validBody, roomId: "" }).success).toBe(false);
  });

  it("rejects image URLs on non-allowlisted hosts", () => {
    const result = segmentRequestSchema.safeParse({
      ...validBody,
      imageUrl: "https://evil.example.com/rooms/before-image.png",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-finite point coordinates", () => {
    expect(
      segmentRequestSchema.safeParse({
        ...validBody,
        point: { x: Number.NaN, y: 0 },
      }).success
    ).toBe(false);
    expect(
      segmentRequestSchema.safeParse({
        ...validBody,
        point: { x: 0, y: Number.POSITIVE_INFINITY },
      }).success
    ).toBe(false);
  });

  it("rejects negative point coordinates", () => {
    expect(
      segmentRequestSchema.safeParse({ ...validBody, point: { x: -1, y: 0 } }).success
    ).toBe(false);
  });

  it("rejects points outside the image bounds", () => {
    expect(
      segmentRequestSchema.safeParse({ ...validBody, point: { x: 1025, y: 384 } }).success
    ).toBe(false);
    expect(
      segmentRequestSchema.safeParse({ ...validBody, point: { x: 512, y: 769 } }).success
    ).toBe(false);
  });

  it("rejects non-integer or non-positive image dimensions", () => {
    expect(
      segmentRequestSchema.safeParse({ ...validBody, imageWidth: 1024.5 }).success
    ).toBe(false);
    expect(segmentRequestSchema.safeParse({ ...validBody, imageWidth: 0 }).success).toBe(false);
    expect(segmentRequestSchema.safeParse({ ...validBody, imageHeight: -768 }).success).toBe(
      false
    );
  });

  it("rejects unknown keys (strict object)", () => {
    expect(
      segmentRequestSchema.safeParse({ ...validBody, maskUrl: "data:image/png;base64,AAAA" })
        .success
    ).toBe(false);
  });
});

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
