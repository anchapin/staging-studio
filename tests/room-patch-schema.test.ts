import { describe, expect, it } from "vitest";

import { roomPatchSchema } from "@/lib/room-patch-schema";

const validBody = {
  selectedVariantIndex: 0,
  beforeImageUrl: "https://abc123.supabase.co/storage/v1/object/public/rooms/before.jpg",
  afterImageUrl: "https://v3.fal.ai/output/after.png",
  beforeImageUrl2: "https://abc123.supabase.co/storage/v1/object/public/rooms/before2.jpg",
  afterImageUrl2: "https://v3.fal.ai/output/after2.png",
};

describe("roomPatchSchema", () => {
  it("accepts a valid patch body with supabase.co and fal.ai hosts", () => {
    const result = roomPatchSchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it("accepts the partial body persistInpaintResult sends for variant slot 0", () => {
    const result = roomPatchSchema.safeParse({
      afterImageUrl: "https://v3.fal.ai/output/after.png",
      selectedVariantIndex: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts the partial body persistInpaintResult sends for variant slot 1", () => {
    const result = roomPatchSchema.safeParse({
      beforeImageUrl2: "https://abc123.supabase.co/storage/v1/object/public/rooms/before.jpg",
      afterImageUrl2: "https://v3.fal.ai/output/after.png",
      selectedVariantIndex: 1,
    });
    expect(result.success).toBe(true);
  });

  it("permits an entirely empty body (the PATCH route guard must reject it before updateMany)", () => {
    const result = roomPatchSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(Object.keys(result.success ? result.data : {})).toHaveLength(0);
  });

  it("rejects an image URL with a disallowed host", () => {
    const result = roomPatchSchema.safeParse({
      ...validBody,
      beforeImageUrl: "https://evil.example.com/before.jpg",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/supabase\.co or \*\.fal\.ai/);
    }
  });

  it("rejects an image URL that is not https", () => {
    const result = roomPatchSchema.safeParse({
      ...validBody,
      afterImageUrl: "http://v3.fal.ai/output/after.png",
    });
    expect(result.success).toBe(false);
  });

  it("rejects selectedVariantIndex: 2", () => {
    const result = roomPatchSchema.safeParse({ ...validBody, selectedVariantIndex: 2 });
    expect(result.success).toBe(false);
  });

  it("accepts http://mock URLs for hermetic test environments (issue #413)", () => {
    const result = roomPatchSchema.safeParse({
      ...validBody,
      afterImageUrl: "http://mock/storage/v1/object/public/rooms/after.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("accepts http://mock:3000 URLs with port for hermetic test environments (issue #413)", () => {
    const result = roomPatchSchema.safeParse({
      ...validBody,
      beforeImageUrl: "http://mock:3000/storage/v1/object/public/rooms/before.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("rejects selectedVariantIndex: -1 and non-integers", () => {
    expect(roomPatchSchema.safeParse({ ...validBody, selectedVariantIndex: -1 }).success).toBe(false);
    expect(roomPatchSchema.safeParse({ ...validBody, selectedVariantIndex: 1.5 }).success).toBe(false);
  });

  it("rejects unknown fields (strict object)", () => {
    const result = roomPatchSchema.safeParse({ ...validBody, sneaky: true });
    expect(result.success).toBe(false);
  });
});
