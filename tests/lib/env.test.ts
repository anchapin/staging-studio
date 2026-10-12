/**
 * `requireEnvVars` + provider preflight helpers.
 *
 * Tests for the generic `requireEnvVars` (parseEnv), plus
 * `assertOpenAIConfigured` (still wired) and `assertAlibabaConfigured`
 * (added with the #1240 migration to Alibaba Cloud DashScope).
 * `assertFalConfigured` was retired with the fal adapter delete (#1240)
 * and is no longer wired anywhere in `src/`.
 */
import { test, expect, afterEach } from "vitest";
import { MissingEnvVarsError, requireEnvVars } from "@/lib/env";
import { assertAlibabaConfigured } from "@/lib/alibaba-adapter";
import { assertOpenAIConfigured } from "@/lib/ai";

// Save originals for restoration
const ORIG = {
  DATABASE_URL: process.env.DATABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ALIBABA_DASHSCOPE_API_KEY: process.env.ALIBABA_DASHSCOPE_API_KEY,
  ALIBABA_BAILIAN_WORKSPACE_ID: process.env.ALIBABA_BAILIAN_WORKSPACE_ID,
  ALIBABA_INPAINT_MODEL: process.env.ALIBABA_INPAINT_MODEL,
  BROWSERLESS_API_KEY: process.env.BROWSERLESS_API_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  PREVIEW_TOKEN_SECRET: process.env.PREVIEW_TOKEN_SECRET,
} as const;

afterEach(() => {
  for (const [key, value] of Object.entries(ORIG)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("requireEnvVars accepts large numeric string values", () => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.ALIBABA_DASHSCOPE_API_KEY = "alibaba-test";
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID = "llm-test";
  process.env.ALIBABA_INPAINT_MODEL = "qwen-image-2.1-pro";
  process.env.DAILY_SEGMENT_LIMIT = "999999999";
  const result = requireEnvVars(
    "OPENAI_API_KEY",
    "ALIBABA_DASHSCOPE_API_KEY",
    "ALIBABA_BAILIAN_WORKSPACE_ID",
    "ALIBABA_INPAINT_MODEL",
    "DAILY_SEGMENT_LIMIT",
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
// assertAlibabaConfigured (#1240)
// ---------------------------------------------------------------------------

/**
 * Tests for the DashScope preflight helper. All three env vars are
 * required: missing any one throws MissingEnvVarsError; setting all
 * three to non-blank strings lets the helper pass. The adapter itself
 * is exercised separately in tests/alibaba-adapter.test.ts; this file
 * just pins the env contract.
 */

test("assertAlibabaConfigured does not throw when all three vars are set", () => {
  process.env.ALIBABA_DASHSCOPE_API_KEY = "alibaba-key-valid";
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID = "llm-valid";
  process.env.ALIBABA_INPAINT_MODEL = "qwen-image-2.1-pro";
  expect(() => assertAlibabaConfigured()).not.toThrow();
});

test("assertAlibabaConfigured throws when ALIBABA_DASHSCOPE_API_KEY is undefined", () => {
  delete process.env.ALIBABA_DASHSCOPE_API_KEY;
  // Set the other two so the throw names the right missing key.
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID = "llm-set";
  process.env.ALIBABA_INPAINT_MODEL = "qwen-image-2.1-pro";
  expect(() => assertAlibabaConfigured()).toThrow(MissingEnvVarsError);
});

test("assertAlibabaConfigured throws when ALIBABA_DASHSCOPE_API_KEY is empty", () => {
  process.env.ALIBABA_DASHSCOPE_API_KEY = "";
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID = "llm-set";
  process.env.ALIBABA_INPAINT_MODEL = "qwen-image-2.1-pro";
  expect(() => assertAlibabaConfigured()).toThrow(MissingEnvVarsError);
});

test("assertAlibabaConfigured throws when ALIBABA_BAILIAN_WORKSPACE_ID is missing", () => {
  process.env.ALIBABA_DASHSCOPE_API_KEY = "alibaba-key";
  delete process.env.ALIBABA_BAILIAN_WORKSPACE_ID;
  process.env.ALIBABA_INPAINT_MODEL = "qwen-image-2.1-pro";
  expect(() => assertAlibabaConfigured()).toThrow(MissingEnvVarsError);
});

test("assertAlibabaConfigured throws when ALIBABA_BAILIAN_WORKSPACE_ID is whitespace", () => {
  process.env.ALIBABA_DASHSCOPE_API_KEY = "alibaba-key";
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID = "   ";
  process.env.ALIBABA_INPAINT_MODEL = "qwen-image-2.1-pro";
  expect(() => assertAlibabaConfigured()).toThrow(MissingEnvVarsError);
});

test("assertAlibabaConfigured throws when ALIBABA_INPAINT_MODEL is missing", () => {
  process.env.ALIBABA_DASHSCOPE_API_KEY = "alibaba-key";
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID = "llm-set";
  delete process.env.ALIBABA_INPAINT_MODEL;
  expect(() => assertAlibabaConfigured()).toThrow(MissingEnvVarsError);
});

test("assertAlibabaConfigured error message names the missing key", () => {
  // Pick one missing key (API key) and verify it appears in the error
  // message so an operator can grep logs to find which env var to set.
  delete process.env.ALIBABA_DASHSCOPE_API_KEY;
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID = "llm-set";
  process.env.ALIBABA_INPAINT_MODEL = "qwen-image-2.1-pro";
  expect(() => assertAlibabaConfigured()).toThrow(/ALIBABA_DASHSCOPE_API_KEY/);
});

test("assertAlibabaConfigured returns void", () => {
  process.env.ALIBABA_DASHSCOPE_API_KEY = "alibaba-key";
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID = "llm-set";
  process.env.ALIBABA_INPAINT_MODEL = "qwen-image-2.1-pro";
  const result = assertAlibabaConfigured();
  expect(result).toBeUndefined();
});