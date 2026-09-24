import { describe, expect, it } from "vitest";

import { settingsSchema } from "@/lib/settings-schema";

/**
 * Pins the /settings form payload validation used by the
 * `updateUserSettings` server action (src/app/actions/settings.ts):
 * required non-empty firm/owner names, optional text fields normalized
 * to null when blank, and logoUrl constrained to the next/image host
 * allowlist (mirroring next.config.ts images.remotePatterns).
 */
describe("settingsSchema", () => {
  const validBase = {
    firmName: "Circle G Designs",
    ownerName: "Lauren Chapin",
    logoUrl: "",
    psychologyPageContent: "",
    signoffContent: "",
    darkMode: false,
  };

  it("accepts the minimal payload with blank optional fields", () => {
    const result = settingsSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firmName).toBe("Circle G Designs");
      expect(result.data.ownerName).toBe("Lauren Chapin");
      expect(result.data.logoUrl).toBeNull();
      expect(result.data.psychologyPageContent).toBeNull();
      expect(result.data.signoffContent).toBeNull();
    }
  });

  it("accepts fully populated payloads", () => {
    const result = settingsSchema.safeParse({
      ...validBase,
      logoUrl:
        "https://myproject.supabase.co/storage/v1/object/public/logos/logo.png",
      psychologyPageContent: "  Buyers fall in love...  ",
      signoffContent: "With love, Lauren",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Text is trimmed; the logo URL passes through unchanged.
      expect(result.data.psychologyPageContent).toBe(
        "Buyers fall in love..."
      );
      expect(result.data.signoffContent).toBe("With love, Lauren");
      expect(result.data.logoUrl).toBe(
        "https://myproject.supabase.co/storage/v1/object/public/logos/logo.png"
      );
    }
  });

  it("rejects blank or whitespace-only firmName/ownerName", () => {
    for (const field of ["firmName", "ownerName"] as const) {
      expect(
        settingsSchema.safeParse({ ...validBase, [field]: "   " }).success
      ).toBe(false);
      expect(
        settingsSchema.safeParse({ ...validBase, [field]: "" }).success
      ).toBe(false);
    }
  });

  it("normalizes whitespace-only optional fields to null", () => {
    const result = settingsSchema.safeParse({
      ...validBase,
      psychologyPageContent: "   ",
      signoffContent: "\n\t ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.psychologyPageContent).toBeNull();
      expect(result.data.signoffContent).toBeNull();
    }
  });

  it("accepts *.supabase.co and *.fal.ai https logo URLs", () => {
    for (const logoUrl of [
      "https://abc123.supabase.co/storage/v1/object/public/logos/l.png",
      "https://v3.fal.ai/result/l.png",
    ]) {
      const result = settingsSchema.safeParse({ ...validBase, logoUrl });
      expect(result.success).toBe(true);
    }
  });

  it("rejects logo URLs outside the next/image host allowlist", () => {
    for (const logoUrl of [
      "http://abc123.supabase.co/l.png", // http, not https
      "https://evil.example.com/l.png", // wrong host
      "https://supabase.co.evil.com/l.png", // host does not END in supabase.co
      "not-a-url",
    ]) {
      const result = settingsSchema.safeParse({ ...validBase, logoUrl });
      expect(result.success).toBe(false);
    }
  });

  it("rejects unknown keys (strict schema)", () => {
    const result = settingsSchema.safeParse({
      ...validBase,
      email: "attacker@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects overly long required names", () => {
    const long = "x".repeat(201);
    expect(
      settingsSchema.safeParse({ ...validBase, firmName: long }).success
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...validBase, ownerName: long }).success
    ).toBe(false);
  });

  it("accepts darkMode as true or false", () => {
    expect(
      settingsSchema.safeParse({ ...validBase, darkMode: true }).success
    ).toBe(true);
    expect(
      settingsSchema.safeParse({ ...validBase, darkMode: false }).success
    ).toBe(true);
  });

  it("rejects darkMode when not a boolean", () => {
    for (const darkMode of ["true", 1, null, undefined]) {
      expect(
        settingsSchema.safeParse({ ...validBase, darkMode }).success
      ).toBe(false);
    }
  });
});
