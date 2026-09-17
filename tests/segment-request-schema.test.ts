import { describe, expect, it } from "vitest";

import { segmentRequestSchema } from "@/lib/ai-route-schemas";

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
