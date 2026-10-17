import { describe, expect, it } from "vitest";

import {
  projectMetadataSchema,
  roomMetadataSchema,
} from "@/lib/metadata-schemas";

const validProjectMetadata = {
  propertyAddress: "123 Magnolia Lane",
  clientName: "The Harpers",
  targetBuyer: "Young professional couple",
  stagingAesthetic: "Organic Modern Luxury",
  stagingPackage: "premium",
  stagingDirectives: "Emphasize natural light and warm neutrals.",
};

const validRoomMetadata = {
  name: "Primary Bedroom",
  rawDirectives: "- Swap TV console for dresser\n- Add reading chair",
};

describe("projectMetadataSchema", () => {
  it("accepts a valid full payload", () => {
    const result = projectMetadataSchema.safeParse(validProjectMetadata);
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload (single field)", () => {
    const result = projectMetadataSchema.safeParse({
      stagingAesthetic: "Warm Transitional",
    });
    expect(result.success).toBe(true);
  });

  it("permits an entirely empty object (setup wizard may omit every field)", () => {
    const result = projectMetadataSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("permits empty strings (an edit may clear a value)", () => {
    const result = projectMetadataSchema.safeParse({ stagingPackage: "" });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown key (strict object)", () => {
    const result = projectMetadataSchema.safeParse({
      ...validProjectMetadata,
      sneaky: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload carrying userId (cannot transfer ownership, issue #682)", () => {
    const result = projectMetadataSchema.safeParse({
      propertyAddress: "123 Magnolia Lane",
      userId: "attacker-user-id",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload carrying id (cannot rewrite the primary key)", () => {
    const result = projectMetadataSchema.safeParse({ id: "other-project" });
    expect(result.success).toBe(false);
  });

  it("rejects non-string field values", () => {
    const result = projectMetadataSchema.safeParse({ clientName: 42 });
    expect(result.success).toBe(false);
  });

  it("rejects fields over 2,000 characters", () => {
    const result = projectMetadataSchema.safeParse({
      stagingDirectives: "a".repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});

describe("roomMetadataSchema", () => {
  it("accepts a valid full payload", () => {
    const result = roomMetadataSchema.safeParse(validRoomMetadata);
    expect(result.success).toBe(true);
  });

  it("accepts a full payload including all three FineTune fields (issue #1362a)", () => {
    // The FineTune persistence slice extends the schema with three new
    // optional fields. The shape mirrors the existing per-row-column
    // pattern (rawDirectives, lookbookHeadline, lookbookBody) — the
    // autosave controller persists only the field the user touched,
    // so a partial patch with just `fineTuneSeed` is also valid.
    const result = roomMetadataSchema.safeParse({
      ...validRoomMetadata,
      fineTuneStrength: 65,
      fineTuneExpand: 18,
      fineTuneSeed: "12345",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload (single field)", () => {
    const result = roomMetadataSchema.safeParse({ rawDirectives: "Add art" });
    expect(result.success).toBe(true);
  });

  it("permits an entirely empty object", () => {
    const result = roomMetadataSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("permits empty strings (an autosave may clear the directives)", () => {
    const result = roomMetadataSchema.safeParse({ rawDirectives: "" });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown key (strict object)", () => {
    const result = roomMetadataSchema.safeParse({
      ...validRoomMetadata,
      sneaky: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload carrying projectId (cannot re-parent the room, issue #682)", () => {
    const result = roomMetadataSchema.safeParse({
      name: "Primary Bedroom",
      projectId: "someone-elses-project",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload carrying selectedVariantIndex (issue #682)", () => {
    const result = roomMetadataSchema.safeParse({
      rawDirectives: "Add art",
      selectedVariantIndex: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload carrying beforeImageUrl (issue #682)", () => {
    const result = roomMetadataSchema.safeParse({
      beforeImageUrl: "https://evil.example.com/before.jpg",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string field values", () => {
    const result = roomMetadataSchema.safeParse({ name: { nested: true } });
    expect(result.success).toBe(false);
  });

  it("rejects fields over 2,000 characters", () => {
    const result = roomMetadataSchema.safeParse({ name: "a".repeat(2001) });
    expect(result.success).toBe(false);
  });

  // Issue #1362a — FineTune persistence. Three bounds tests pinned
  // explicitly so a future schema change can't silently widen the
  // FineTune surface (the UI caps the sliders at 0..100 / 0..40, the
  // seed input strips non-digits and caps at 6 chars).
  it("accepts fineTuneStrength at the boundary 0 and 100", () => {
    expect(
      roomMetadataSchema.safeParse({ fineTuneStrength: 0 }).success
    ).toBe(true);
    expect(
      roomMetadataSchema.safeParse({ fineTuneStrength: 100 }).success
    ).toBe(true);
  });

  it("rejects fineTuneStrength outside the 0..100 UI range", () => {
    expect(
      roomMetadataSchema.safeParse({ fineTuneStrength: -1 }).success
    ).toBe(false);
    expect(
      roomMetadataSchema.safeParse({ fineTuneStrength: 101 }).success
    ).toBe(false);
  });

  it("rejects non-integer fineTuneStrength", () => {
    expect(
      roomMetadataSchema.safeParse({ fineTuneStrength: 50.5 }).success
    ).toBe(false);
  });

  it("accepts fineTuneExpand at the boundary 0 and 40", () => {
    expect(
      roomMetadataSchema.safeParse({ fineTuneExpand: 0 }).success
    ).toBe(true);
    expect(
      roomMetadataSchema.safeParse({ fineTuneExpand: 40 }).success
    ).toBe(true);
  });

  it("rejects fineTuneExpand outside the 0..40 UI range", () => {
    expect(
      roomMetadataSchema.safeParse({ fineTuneExpand: 41 }).success
    ).toBe(false);
  });

  it("accepts fineTuneSeed as a digits-only string of up to 6 chars", () => {
    expect(
      roomMetadataSchema.safeParse({ fineTuneSeed: "" }).success
    ).toBe(true);
    expect(
      roomMetadataSchema.safeParse({ fineTuneSeed: "123456" }).success
    ).toBe(true);
  });

  it("rejects fineTuneSeed containing non-digits or over 6 chars", () => {
    expect(
      roomMetadataSchema.safeParse({ fineTuneSeed: "12a" }).success
    ).toBe(false);
    expect(
      roomMetadataSchema.safeParse({ fineTuneSeed: "1234567" }).success
    ).toBe(false);
  });
});
