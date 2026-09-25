import { test, expect, afterEach } from "vitest";
import { MissingEnvVarsError, requireEnvVars } from "@/lib/env";
import { assertFalConfigured } from "@/lib/fal";
import { assertOpenAIConfigured } from "@/lib/ai";

// Save originals for restoration
const ORIG = {
  DATABASE_URL: process.env.DATABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  FAL_KEY: process.env.FAL_KEY,
  BROWSERLESS_API_KEY: process.env.BROWSERLESS_API_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  PREVIEW_TOKEN_SECRET: process.env.PREVIEW_TOKEN_SECRET,
  TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
  DAILY_INPAINT_LIMIT: process.env.DAILY_INPAINT_LIMIT,
  DAILY_COPY_LIMIT: process.env.DAILY_COPY_LIMIT,
  DAILY_LABEL_LIMIT: process.env.DAILY_LABEL_LIMIT,
  DAILY_EXPORT_LIMIT: process.env.DAILY_EXPORT_LIMIT,
  DAILY_SEGMENT_LIMIT: process.env.DAILY_SEGMENT_LIMIT,
} as const;

afterEach(() => {
  // Restore all env vars to original state
  process.env.DATABASE_URL = ORIG.DATABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIG.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.OPENAI_API_KEY = ORIG.OPENAI_API_KEY;
  process.env.FAL_KEY = ORIG.FAL_KEY;
  process.env.BROWSERLESS_API_KEY = ORIG.BROWSERLESS_API_KEY;
  process.env.NEXT_PUBLIC_APP_URL = ORIG.NEXT_PUBLIC_APP_URL;
  process.env.PREVIEW_TOKEN_SECRET = ORIG.PREVIEW_TOKEN_SECRET;
  process.env.TYPESAFE_API_KEY = ORIG.TYPESAFE_API_KEY;
  process.env.DAILY_INPAINT_LIMIT = ORIG.DAILY_INPAINT_LIMIT;
  process.env.DAILY_COPY_LIMIT = ORIG.DAILY_COPY_LIMIT;
  process.env.DAILY_LABEL_LIMIT = ORIG.DAILY_LABEL_LIMIT;
  process.env.DAILY_EXPORT_LIMIT = ORIG.DAILY_EXPORT_LIMIT;
  process.env.DAILY_SEGMENT_LIMIT = ORIG.DAILY_SEGMENT_LIMIT;
});

function clearAll() {
  delete process.env.DATABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.FAL_KEY;
  delete process.env.BROWSERLESS_API_KEY;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.PREVIEW_TOKEN_SECRET;
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.DAILY_INPAINT_LIMIT;
  delete process.env.DAILY_COPY_LIMIT;
  delete process.env.DAILY_LABEL_LIMIT;
  delete process.env.DAILY_EXPORT_LIMIT;
  delete process.env.DAILY_SEGMENT_LIMIT;
}

// ---------------------------------------------------------------------------
// MissingEnvVarsError
// ---------------------------------------------------------------------------

test("MissingEnvVarsError is an Error subclass", () => {
  const err = new MissingEnvVarsError(["OPENAI_API_KEY"]);
  expect(err).toBeInstanceOf(Error);
  expect(err).toBeInstanceOf(MissingEnvVarsError);
});

test("MissingEnvVarsError.name is MissingEnvVarsError", () => {
  const err = new MissingEnvVarsError(["OPENAI_API_KEY"]);
  expect(err.name).toBe("MissingEnvVarsError");
});

test("MissingEnvVarsError.missingVars exposes the failed var names", () => {
  const err = new MissingEnvVarsError(["OPENAI_API_KEY", "FAL_KEY"]);
  expect(err.missingVars).toEqual(["OPENAI_API_KEY", "FAL_KEY"]);
});

test("MissingEnvVarsError message includes var name with doc link", () => {
  const err = new MissingEnvVarsError(["OPENAI_API_KEY"]);
  expect(err.message).toContain("OPENAI_API_KEY");
  expect(err.message).toContain("platform.openai.com");
  expect(err.message).toContain("Missing required environment variables:");
});

test("MissingEnvVarsError message falls back to .env.example for unknown vars", () => {
  const err = new MissingEnvVarsError(["UNKNOWN_VAR"]);
  expect(err.message).toContain("UNKNOWN_VAR");
  expect(err.message).toContain("see .env.example");
});

test("MissingEnvVarsError message includes fix instructions", () => {
  const err = new MissingEnvVarsError(["OPENAI_API_KEY"]);
  expect(err.message).toContain("cp .env.example .env.local");
});

test("MissingEnvVarsError formats multiple missing vars each on their own line", () => {
  const err = new MissingEnvVarsError(["OPENAI_API_KEY", "FAL_KEY", "DATABASE_URL"]);
  expect(err.message).toContain("OPENAI_API_KEY");
  expect(err.message).toContain("FAL_KEY");
  expect(err.message).toContain("DATABASE_URL");
  // Each should appear with a dash bullet
  const dashCount = (err.message.match(/  - /g) ?? []).length;
  expect(dashCount).toBe(3);
});

// ---------------------------------------------------------------------------
// requireEnvVars – success cases
// ---------------------------------------------------------------------------

test("requireEnvVars returns resolved values for required vars when all present", () => {
  process.env.OPENAI_API_KEY = "sk-test-openai-123";
  process.env.FAL_KEY = "fal-key-abc";
  process.env.DATABASE_URL = "postgresql://localhost:5432/db";

  const result = requireEnvVars("OPENAI_API_KEY", "FAL_KEY", "DATABASE_URL");
  expect(result).toEqual({
    OPENAI_API_KEY: "sk-test-openai-123",
    FAL_KEY: "fal-key-abc",
    DATABASE_URL: "postgresql://localhost:5432/db",
  });
});

test("requireEnvVars with all required env vars passes", () => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/studio";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://myproject.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGc...";
  process.env.OPENAI_API_KEY = "sk-openai-test";
  process.env.FAL_KEY = "fal-test-key";
  process.env.BROWSERLESS_API_KEY = "browserless-test";
  process.env.NEXT_PUBLIC_APP_URL = "https://example.com";

  const result = requireEnvVars(
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "OPENAI_API_KEY",
    "FAL_KEY",
    "BROWSERLESS_API_KEY",
    "NEXT_PUBLIC_APP_URL"
  );
  expect(result.DATABASE_URL).toBe("postgresql://localhost:5432/studio");
  expect(result.NEXT_PUBLIC_SUPABASE_URL).toBe("https://myproject.supabase.co");
  expect(result.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("eyJhbGc...");
  expect(result.OPENAI_API_KEY).toBe("sk-openai-test");
  expect(result.FAL_KEY).toBe("fal-test-key");
  expect(result.BROWSERLESS_API_KEY).toBe("browserless-test");
  expect(result.NEXT_PUBLIC_APP_URL).toBe("https://example.com");
});

test("requireEnvVars with optional vars present does not throw", () => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.FAL_KEY = "fal-test";
  process.env.PREVIEW_TOKEN_SECRET = "preview-secret-abc";
  process.env.TYPESAFE_API_KEY = "typesafe-key";
  process.env.DAILY_INPAINT_LIMIT = "20";
  process.env.DAILY_COPY_LIMIT = "50";
  process.env.DAILY_LABEL_LIMIT = "50";
  process.env.DAILY_EXPORT_LIMIT = "20";
  process.env.DAILY_SEGMENT_LIMIT = "100";

  expect(() =>
    requireEnvVars(
      "OPENAI_API_KEY",
      "FAL_KEY",
      "PREVIEW_TOKEN_SECRET",
      "TYPESAFE_API_KEY",
      "DAILY_INPAINT_LIMIT",
      "DAILY_COPY_LIMIT",
      "DAILY_LABEL_LIMIT",
      "DAILY_EXPORT_LIMIT",
      "DAILY_SEGMENT_LIMIT"
    )
  ).not.toThrow();
});

test("requireEnvVars returns all resolved values including optional vars", () => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.FAL_KEY = "fal-test";
  process.env.PREVIEW_TOKEN_SECRET = "secret123";
  process.env.DAILY_INPAINT_LIMIT = "20";

  const result = requireEnvVars(
    "OPENAI_API_KEY",
    "FAL_KEY",
    "PREVIEW_TOKEN_SECRET",
    "DAILY_INPAINT_LIMIT"
  );
  expect(result.PREVIEW_TOKEN_SECRET).toBe("secret123");
  expect(result.DAILY_INPAINT_LIMIT).toBe("20");
});

// ---------------------------------------------------------------------------
// requireEnvVars – error cases (missing required vars)
// ---------------------------------------------------------------------------

test("requireEnvVars throws MissingEnvVarsError when a required var is undefined", () => {
  delete process.env.OPENAI_API_KEY;
  expect(() => requireEnvVars("OPENAI_API_KEY")).toThrow(MissingEnvVarsError);
});

test("requireEnvVars throws when only some vars are missing", () => {
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.FAL_KEY;
  expect(() => requireEnvVars("OPENAI_API_KEY", "FAL_KEY")).toThrow(
    MissingEnvVarsError
  );
});

test("thrown MissingEnvVarsError includes only the vars that were missing", () => {
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.FAL_KEY;
  delete process.env.BROWSERLESS_API_KEY;
  try {
    requireEnvVars("OPENAI_API_KEY", "FAL_KEY", "BROWSERLESS_API_KEY");
  } catch (err) {
    expect((err as MissingEnvVarsError).missingVars).toContain("FAL_KEY");
    expect((err as MissingEnvVarsError).missingVars).toContain(
      "BROWSERLESS_API_KEY"
    );
    expect(
      (err as MissingEnvVarsError).missingVars
    ).not.toContain("OPENAI_API_KEY");
  }
});

test("requireEnvVars throws with all required vars missing", () => {
  clearAll();
  expect(() =>
    requireEnvVars(
      "DATABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "OPENAI_API_KEY",
      "FAL_KEY",
      "BROWSERLESS_API_KEY",
      "NEXT_PUBLIC_APP_URL"
    )
  ).toThrow(MissingEnvVarsError);
});

// ---------------------------------------------------------------------------
// requireEnvVars – edge cases (empty / whitespace-only)
// ---------------------------------------------------------------------------

test("requireEnvVars throws on empty string", () => {
  process.env.OPENAI_API_KEY = "";
  expect(() => requireEnvVars("OPENAI_API_KEY")).toThrow(MissingEnvVarsError);
});

test("requireEnvVars throws on whitespace-only string", () => {
  process.env.OPENAI_API_KEY = "   ";
  expect(() => requireEnvVars("OPENAI_API_KEY")).toThrow(MissingEnvVarsError);
});

test("requireEnvVars throws on tab-only string", () => {
  process.env.OPENAI_API_KEY = "\t";
  expect(() => requireEnvVars("OPENAI_API_KEY")).toThrow(MissingEnvVarsError);
});

test("requireEnvVars throws on newline-only string", () => {
  process.env.OPENAI_API_KEY = "\n";
  expect(() => requireEnvVars("OPENAI_API_KEY")).toThrow(MissingEnvVarsError);
});

test("requireEnvVars accepts value with surrounding whitespace", () => {
  process.env.OPENAI_API_KEY = "  sk-test-key  ";
  const result = requireEnvVars("OPENAI_API_KEY");
  // trim() is only used for the presence check; the actual value is returned as-is
  expect(result.OPENAI_API_KEY).toBe("  sk-test-key  ");
});

test("requireEnvVars accepts value containing special characters", () => {
  process.env.OPENAI_API_KEY = "sk-live_abc-123!@#$%";
  const result = requireEnvVars("OPENAI_API_KEY");
  expect(result.OPENAI_API_KEY).toBe("sk-live_abc-123!@#$%");
});

test("requireEnvVars with no arguments returns empty object", () => {
  const result = requireEnvVars();
  expect(result).toEqual({});
});

test("requireEnvVars single var returns single-key object", () => {
  process.env.FAL_KEY = "fal-key-value";
  const result = requireEnvVars("FAL_KEY");
  expect(result).toEqual({ FAL_KEY: "fal-key-value" });
});

// ---------------------------------------------------------------------------
// Numeric boundary edge cases
// ---------------------------------------------------------------------------

test("requireEnvVars accepts numeric limit values as strings", () => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.FAL_KEY = "fal-test";
  process.env.DAILY_INPAINT_LIMIT = "0";
  process.env.DAILY_COPY_LIMIT = "999";
  const result = requireEnvVars(
    "OPENAI_API_KEY",
    "FAL_KEY",
    "DAILY_INPAINT_LIMIT",
    "DAILY_COPY_LIMIT"
  );
  expect(result.DAILY_INPAINT_LIMIT).toBe("0");
  expect(result.DAILY_COPY_LIMIT).toBe("999");
});

test("requireEnvVars accepts non-numeric string values for limit vars", () => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.FAL_KEY = "fal-test";
  // Limits can be any string; parsing is caller's responsibility
  process.env.DAILY_INPAINT_LIMIT = "unlimited";
  const result = requireEnvVars(
    "OPENAI_API_KEY",
    "FAL_KEY",
    "DAILY_INPAINT_LIMIT"
  );
  expect(result.DAILY_INPAINT_LIMIT).toBe("unlimited");
});

test("requireEnvVars accepts large numeric string values", () => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.FAL_KEY = "fal-test";
  process.env.DAILY_SEGMENT_LIMIT = "999999999";
  const result = requireEnvVars(
    "OPENAI_API_KEY",
    "FAL_KEY",
    "DAILY_SEGMENT_LIMIT"
  );
  expect(result.DAILY_SEGMENT_LIMIT).toBe("999999999");
});

// ---------------------------------------------------------------------------
// assertOpenAIConfigured
// ---------------------------------------------------------------------------

test("assertOpenAIConfigured does not throw when OPENAI_API_KEY is set", () => {
  process.env.OPENAI_API_KEY = "sk-openai-test-key";
  expect(() => assertOpenAIConfigured()).not.toThrow();
});

test("assertOpenAIConfigured throws MissingEnvVarsError when OPENAI_API_KEY is missing", () => {
  delete process.env.OPENAI_API_KEY;
  expect(() => assertOpenAIConfigured()).toThrow(MissingEnvVarsError);
});

test("assertOpenAIConfigured throws on empty OPENAI_API_KEY", () => {
  process.env.OPENAI_API_KEY = "";
  expect(() => assertOpenAIConfigured()).toThrow(MissingEnvVarsError);
});

test("assertOpenAIConfigured returns void", () => {
  process.env.OPENAI_API_KEY = "sk-openai-valid";
  const result = assertOpenAIConfigured();
  expect(result).toBeUndefined();
});

// ---------------------------------------------------------------------------
// assertFalConfigured
// ---------------------------------------------------------------------------

test("assertFalConfigured does not throw when FAL_KEY is set", () => {
  process.env.FAL_KEY = "fal-key-valid";
  expect(() => assertFalConfigured()).not.toThrow();
});

test("assertFalConfigured throws MissingEnvVarsError when FAL_KEY is missing", () => {
  delete process.env.FAL_KEY;
  expect(() => assertFalConfigured()).toThrow(MissingEnvVarsError);
});

test("assertFalConfigured throws on empty FAL_KEY", () => {
  process.env.FAL_KEY = "   ";
  expect(() => assertFalConfigured()).toThrow(MissingEnvVarsError);
});

test("assertFalConfigured returns void", () => {
  process.env.FAL_KEY = "fal-key-valid";
  const result = assertFalConfigured();
  expect(result).toBeUndefined();
});
