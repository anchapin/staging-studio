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
});
