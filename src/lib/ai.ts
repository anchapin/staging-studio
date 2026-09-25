import { openai } from "@ai-sdk/openai";
import { requireEnvVars } from "@/lib/env";
import { getCircuitBreaker } from "@/lib/circuit-breaker";
import { componentLogger } from "@/lib/logger";

const log = componentLogger("ai");

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
  fn: () => Promise<T>
): Promise<T> {
  const cb = getCircuitBreaker("openai", {
    failureThreshold: 3,
    cooldownMs: 30_000,
  });
  try {
    return await cb.execute(fn);
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const isRetryable = /rate limit|429|503|502|too many requests/i.test(errMessage);
    log.error(
      {
        type: "ai_api_error",
        error: errMessage,
        retryable: isRetryable,
        fallback: "circuit_breaker_open",
      },
      `OpenAI / AI call failed (${errMessage})`
    );
    throw err;
  }
}

/**
 * Logs an AI API error with structured metadata extracted from the error.
 * Use this when you have additional context (e.g., model, prompt length, tokens).
 */
export function trackAIError(params: {
  err: unknown;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  context?: Record<string, unknown>;
}) {
  const { err, model = "gpt-4o-mini", promptTokens, completionTokens, context } = params;
  const errMessage = err instanceof Error ? err.message : String(err);
  const isRateLimit = /rate limit|429|too many requests/i.test(errMessage);
  const isRetryable = isRateLimit || /503|502|timeout|ECONNREFUSED/i.test(errMessage);

  log.error(
    {
      type: "ai_api_error",
      model,
      error: errMessage,
      retryable: isRetryable,
      ...(promptTokens !== undefined && { promptTokens }),
      ...(completionTokens !== undefined && { completionTokens }),
      ...(context && { context }),
    },
    `AI API error: ${errMessage}`
  );
}
