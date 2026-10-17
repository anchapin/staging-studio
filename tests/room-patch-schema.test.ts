import { afterEach, describe, expect, it, vi } from "vitest";

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
      afterImageUrl2: "https://v3.fal.ai/output/after2.png",
      selectedVariantIndex: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts sortOrder for room reordering (issue #493)", () => {
    const result = roomPatchSchema.safeParse({ sortOrder: 0 });
    expect(result.success).toBe(true);
  });

  it("accepts sortOrder with various non-negative integers", () => {
    expect(roomPatchSchema.safeParse({ sortOrder: 0 }).success).toBe(true);
    expect(roomPatchSchema.safeParse({ sortOrder: 5 }).success).toBe(true);
    expect(roomPatchSchema.safeParse({ sortOrder: 100 }).success).toBe(true);
  });

  it("rejects negative sortOrder", () => {
    const result = roomPatchSchema.safeParse({ sortOrder: -1 });
    expect(result.success).toBe(false);
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

  // Issue #1112: loopback URL acceptance is gated on E2E_HERMETIC=1.
  // In the production config (flag unset, the default for this test
  // suite), the schema MUST reject http://127.0.0.1 and http://localhost
  // URLs — otherwise an authenticated project owner could PATCH a
  // loopback URL onto `Room.afterImageUrl` and the next/image optimizer
  // would fetch the app's own loopback (SSRF surface). The `mock` host
  // is unrelated to this gate (issue #413) and still accepts below.
  it("rejects http://127.0.0.1 URLs in the production config (no E2E_HERMETIC)", () => {
    const result = roomPatchSchema.safeParse({
      ...validBody,
      afterImageUrl: "http://127.0.0.1:1234/probe.png",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(
        /Image URL must be https/
      );
    }
  });

  it("rejects http://localhost URLs in the production config (no E2E_HERMETIC)", () => {
    const result = roomPatchSchema.safeParse({
      ...validBody,
      beforeImageUrl: "http://localhost:5678/probe.png",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(
        /Image URL must be https/
      );
    }
  });

  it("rejects loopback URLs with non-loopback http hosts in the production config", () => {
    // Even with no port, the http scheme hits the same rejection branch.
    expect(
      roomPatchSchema.safeParse({
        ...validBody,
        beforeImageUrl: "http://127.0.0.1/foo.png",
      }).success
    ).toBe(false);
    expect(
      roomPatchSchema.safeParse({
        ...validBody,
        afterImageUrl: "http://localhost/foo.png",
      }).success
    ).toBe(false);
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

describe("roomPatchSchema under E2E_HERMETIC=1 (issue #1112)", () => {
  // The schema reads `process.env.E2E_HERMETIC` at module-load time and
  // freezes the resulting gate, so the only way to test the loopback
  // *acceptance* branch is to set the env, reset the module cache, and
  // re-import. Keep this block narrow — it's a single configuration
  // exercise, not a fresh test of every URL shape (covered above and in
  // the predicate's own tests).
  const originalEnv = process.env.E2E_HERMETIC;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.E2E_HERMETIC;
    } else {
      process.env.E2E_HERMETIC = originalEnv;
    }
    vi.resetModules();
  });

  it("accepts http://127.0.0.1 with a non-default port when E2E_HERMETIC=1", async () => {
    process.env.E2E_HERMETIC = "1";
    vi.resetModules();
    const { roomPatchSchema: hermeticSchema } = await import(
      "@/lib/room-patch-schema"
    );
    const result = hermeticSchema.safeParse({
      ...validBody,
      afterImageUrl: "http://127.0.0.1:1234/probe.png",
    });
    expect(result.success).toBe(true);
  });

  it("accepts http://localhost with a non-default port when E2E_HERMETIC=1", async () => {
    process.env.E2E_HERMETIC = "1";
    vi.resetModules();
    const { roomPatchSchema: hermeticSchema } = await import(
      "@/lib/room-patch-schema"
    );
    const result = hermeticSchema.safeParse({
      ...validBody,
      beforeImageUrl: "http://localhost:5678/probe.png",
    });
    expect(result.success).toBe(true);
  });

  it("does NOT widen to other http hosts even when E2E_HERMETIC=1 (loopback-only)", async () => {
    process.env.E2E_HERMETIC = "1";
    vi.resetModules();
    const { roomPatchSchema: hermeticSchema } = await import(
      "@/lib/room-patch-schema"
    );
    // http://example.com is neither supabase/fal nor a loopback host —
    // the gate is loopback-specific, not a wholesale http allowance.
    const result = hermeticSchema.safeParse({
      ...validBody,
      afterImageUrl: "http://example.com/probe.png",
    });
    expect(result.success).toBe(false);
  });
});
