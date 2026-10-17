import { describe, expect, it } from "vitest";

import {
  LISTING_COPY_BODY_MAX,
  LISTING_COPY_HEADLINE_MAX,
  listingCopyOutputSchema,
  listingCopyRequestSchema,
} from "@/lib/ai-route-schemas";

describe("listingCopyRequestSchema (issue #1343, /api/v1/listing-copy request body)", () => {
  it("accepts a body carrying only roomId", () => {
    const result = listingCopyRequestSchema.safeParse({ roomId: "room_123" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ roomId: "room_123" });
    }
  });

  it("rejects a body missing roomId", () => {
    expect(listingCopyRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty roomId", () => {
    expect(listingCopyRequestSchema.safeParse({ roomId: "" }).success).toBe(false);
  });

  it("rejects legacy prompt-context fields (strict object — same rule as generate-copy)", () => {
    const result = listingCopyRequestSchema.safeParse({
      roomId: "room_123",
      roomName: "Primary Bedroom",
      rawDirectives: "King bed centered on the accent wall.",
      aesthetic: "Organic Modern Luxury",
      targetBuyer: "Young families",
      priorHeadline: "Anything goes here",
      tone: "creative",
    });
    expect(result.success).toBe(false);
  });
});

describe("listingCopyOutputSchema (issue #1343, /api/v1/listing-copy response body)", () => {
  it("accepts a headline + body within the CopyPanel caps", () => {
    const result = listingCopyOutputSchema.safeParse({
      headline: "Bright & airy living room with restored crown molding",
      body: "Soft linen sofa centered under the original archway; warm walnut floors anchor the room.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headline).toBe(
        "Bright & airy living room with restored crown molding"
      );
      expect(result.data.body).toBe(
        "Soft linen sofa centered under the original archway; warm walnut floors anchor the room."
      );
    }
  });

  it("exposes the same caps the CopyPanel pins (200 / 600), matching listingCopySchema", () => {
    // Drift between prompt-side caps and schema caps would let a
    // borderline-long headline land past `saveListingCopy`'s
    // validation; the constants exist as a single source of truth so
    // a future prompt edit cannot silently regress.
    expect(LISTING_COPY_HEADLINE_MAX).toBe(200);
    expect(LISTING_COPY_BODY_MAX).toBe(600);
  });

  it("rejects an empty or whitespace-only headline / body", () => {
    expect(
      listingCopyOutputSchema.safeParse({ headline: "", body: "Anything goes." }).success
    ).toBe(false);
    expect(
      listingCopyOutputSchema.safeParse({ headline: "   ", body: "Anything goes." }).success
    ).toBe(false);
    expect(
      listingCopyOutputSchema.safeParse({ headline: "Bright room", body: "" }).success
    ).toBe(false);
    expect(
      listingCopyOutputSchema.safeParse({ headline: "Bright room", body: "   " }).success
    ).toBe(false);
  });

  it("rejects headline / body over the cap", () => {
    const tooLongHeadline = "a".repeat(LISTING_COPY_HEADLINE_MAX + 1);
    const tooLongBody = "a".repeat(LISTING_COPY_BODY_MAX + 1);
    expect(
      listingCopyOutputSchema.safeParse({
        headline: tooLongHeadline,
        body: "Anything goes.",
      }).success
    ).toBe(false);
    expect(
      listingCopyOutputSchema.safeParse({
        headline: "Bright room",
        body: tooLongBody,
      }).success
    ).toBe(false);
  });

  it("accepts headline / body exactly at the cap", () => {
    const atHeadline = "a".repeat(LISTING_COPY_HEADLINE_MAX);
    const atBody = "a".repeat(LISTING_COPY_BODY_MAX);
    expect(
      listingCopyOutputSchema.safeParse({ headline: atHeadline, body: atBody }).success
    ).toBe(true);
  });

  it("does not enforce strictness on unknown keys (output is a permissive z.object — mirrors CopyOutputSchema)", () => {
    // The output schema is intentionally permissive: the AI SDK's
    // `generateObject` returns `object` as a parsed shape, but a
    // malformed model response can still surface extra keys (rare
    // in practice; the SDK strips most). A strict `.object()`
    // would reject those and refund the quota, which is undesirable
    // when the headline/body still validate. The route validates
    // the structured fields it cares about and ignores the rest.
    const result = listingCopyOutputSchema.safeParse({
      headline: "Bright room",
      body: "Anything goes.",
      extra: "ignored",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headline).toBe("Bright room");
      expect(result.data.body).toBe("Anything goes.");
    }
  });
});