import { openai } from "@ai-sdk/openai";
import { requireEnvVars } from "@/lib/env";
import { getCircuitBreaker } from "@/lib/circuit-breaker";
import { withRetry } from "@/lib/retry";

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

export async function generateWithCircuitBreaker<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const cb = getCircuitBreaker("openai", {
    failureThreshold: 3,
    cooldownMs: 30_000,
  });
  // Combine circuit breaker with exponential backoff retry
  return withRetry(() => cb.execute(fn), 5, 1000, 30000);
}
