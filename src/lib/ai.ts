import { openai } from "@ai-sdk/openai";
import { requireEnvVars } from "@/lib/env";

/**
 * Shared OpenAI chat model instance (gpt-4o-mini) for the Vercel AI SDK.
 *
 * Purpose: the single sanctioned model construction site. Import
 * `aiModel` wherever AI text generation is invoked (see
 * `api/generate-copy`); never call `openai(...)` elsewhere.
 *
 * Side effects: constructs the model handle at import time. Making an
 * actual request requires `OPENAI_API_KEY` — call `assertOpenAIConfigured()`
 * first (or let `requireEnvVars` throw) in server-only code paths.
 */
export const aiModel = openai("gpt-4o-mini");

/**
 * Asserts that the OpenAI provider is usable before doing work.
 *
 * Purpose: cheap preflight guard for AI routes — throws
 * `MissingEnvVarsError` naming `OPENAI_API_KEY` if it is unset or blank,
 * instead of letting the SDK fail later with an opaque auth error.
 *
 * Side effects: reads `process.env.OPENAI_API_KEY`; throws when missing.
 */
export function assertOpenAIConfigured(): void {
  requireEnvVars("OPENAI_API_KEY");
}
