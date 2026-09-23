import { describe, expect, it } from "vitest";

import {
  BATCH_ROOM_TYPE_MAX_IMAGES,
  batchRoomTypesRequestSchema,
  generateCopyRequestSchema,
  visionLabelRequestSchema,
} from "@/lib/ai-route-schemas";

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
  const validBody = {
    roomId: "room_123",
    imageUrl: "https://xxxx.supabase.co/storage/v1/object/room.jpg",
    concept: "sofa",
    crops: [crop],
  };

  it("accepts a body with roomId, imageUrl, concept, and one or more crops", () => {
    const result = visionLabelRequestSchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it("rejects an empty crop list and more than the max", () => {
    expect(
      visionLabelRequestSchema.safeParse({ ...validBody, crops: [] }).success
    ).toBe(false);
    const tooMany = Array.from({ length: 31 }, (_, index) => ({
      instanceIndex: index,
      cropDataUrl: `data:image/jpeg;base64,${"A".repeat(200)}`,
    }));
    expect(
      visionLabelRequestSchema.safeParse({ ...validBody, crops: tooMany }).success
    ).toBe(false);
  });

  it("rejects non-data-URL crops and invalid concepts", () => {
    expect(
      visionLabelRequestSchema.safeParse({
        ...validBody,
        crops: [{ instanceIndex: 0, cropDataUrl: "https://example.com/crop.png" }],
      }).success
    ).toBe(false);
    expect(
      visionLabelRequestSchema.safeParse({
        ...validBody,
        concept: "Red Sofa!",
      }).success
    ).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(
      visionLabelRequestSchema.safeParse({
        ...validBody,
        extraField: "not allowed",
      }).success
    ).toBe(false);
  });
});

describe("batchRoomTypesRequestSchema (detectBatchRoomTypes gate, issue #681)", () => {
  const validUrl =
    "https://xxxx.supabase.co/storage/v1/object/public/room-photos/batch-rooms/p1/room-0.jpg";

  it("accepts a projectId with one allowlisted image URL", () => {
    const result = batchRoomTypesRequestSchema.safeParse({
      projectId: "project_123",
      imageUrls: [validUrl],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        projectId: "project_123",
        imageUrls: [validUrl],
      });
    }
  });

  it("accepts a batch exactly at the cap", () => {
    const result = batchRoomTypesRequestSchema.safeParse({
      projectId: "project_123",
      imageUrls: Array.from({ length: BATCH_ROOM_TYPE_MAX_IMAGES }, () => validUrl),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty list and a list over the cap", () => {
    expect(
      batchRoomTypesRequestSchema.safeParse({ projectId: "project_123", imageUrls: [] })
        .success
    ).toBe(false);
    expect(
      batchRoomTypesRequestSchema.safeParse({
        projectId: "project_123",
        imageUrls: Array.from(
          { length: BATCH_ROOM_TYPE_MAX_IMAGES + 1 },
          () => validUrl
        ),
      }).success
    ).toBe(false);
  });

  it("rejects non-allowlisted hosts, plain http, and non-URLs per entry", () => {
    const badUrls = [
      "https://example.com/room.jpg", // host not on the allowlist
      "http://xxxx.supabase.co/room.jpg", // not https
      "not-a-url",
      "",
    ];
    for (const bad of badUrls) {
      expect(
        batchRoomTypesRequestSchema.safeParse({
          projectId: "project_123",
          imageUrls: [validUrl, bad],
        }).success
      ).toBe(false);
    }
  });

  it("rejects a missing or empty projectId and unknown keys (strict)", () => {
    expect(
      batchRoomTypesRequestSchema.safeParse({ imageUrls: [validUrl] }).success
    ).toBe(false);
    expect(
      batchRoomTypesRequestSchema.safeParse({ projectId: "", imageUrls: [validUrl] })
        .success
    ).toBe(false);
    expect(
      batchRoomTypesRequestSchema.safeParse({
        projectId: "project_123",
        imageUrls: [validUrl],
        extraField: "not allowed",
      }).success
    ).toBe(false);
  });
});
