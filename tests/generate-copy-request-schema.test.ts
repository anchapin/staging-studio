import { describe, expect, it } from "vitest";

import { generateCopyRequestSchema } from "@/lib/ai-route-schemas";

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
