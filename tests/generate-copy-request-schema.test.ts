import { describe, expect, it } from "vitest";

import { generateCopyRequestSchema, visionLabelRequestSchema } from "@/lib/ai-route-schemas";

describe("generateCopyRequestSchema", () => {
  it("accepts a body carrying only roomId", () => {
    const result = generateCopyRequestSchema.safeParse({ roomId: "room_123" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ roomId: "room_123" });
    }
  });

  it("rejects a body missing roomId", () => {
    expect(generateCopyRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty roomId", () => {
    expect(generateCopyRequestSchema.safeParse({ roomId: "" }).success).toBe(false);
  });

  it("rejects legacy prompt-context fields (strict object)", () => {
    const result = generateCopyRequestSchema.safeParse({
      roomId: "room_123",
      roomName: "Primary Bedroom",
      rawDirectives: "King bed centered on the accent wall.",
      aesthetic: "Organic Modern Luxury",
      targetBuyer: "Young families",
    });
    expect(result.success).toBe(false);
  });
});

describe("visionLabelRequestSchema", () => {
  const crop = { instanceIndex: 0, cropDataUrl: `data:image/jpeg;base64,${"A".repeat(200)}` };

  it("accepts a body with roomId, concept, and one or more crops", () => {
    const result = visionLabelRequestSchema.safeParse({
      roomId: "room_123",
      concept: "sofa",
      crops: [crop],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty crop list and more than the max", () => {
    expect(
      visionLabelRequestSchema.safeParse({ roomId: "r", concept: "sofa", crops: [] }).success
    ).toBe(false);
    const tooMany = Array.from({ length: 31 }, (_, index) => ({
      instanceIndex: index,
      cropDataUrl: `data:image/jpeg;base64,${"A".repeat(200)}`,
    }));
    expect(
      visionLabelRequestSchema.safeParse({ roomId: "r", concept: "sofa", crops: tooMany }).success
    ).toBe(false);
  });

  it("rejects non-data-URL crops and invalid concepts", () => {
    expect(
      visionLabelRequestSchema.safeParse({
        roomId: "r",
        concept: "sofa",
        crops: [{ instanceIndex: 0, cropDataUrl: "https://example.com/crop.png" }],
      }).success
    ).toBe(false);
    expect(
      visionLabelRequestSchema.safeParse({
        roomId: "r",
        concept: "Red Sofa!",
        crops: [crop],
      }).success
    ).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(
      visionLabelRequestSchema.safeParse({
        roomId: "r",
        concept: "sofa",
        crops: [crop],
        imageUrl: "https://example.com/room.jpg",
      }).success
    ).toBe(false);
  });
});
