import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { requireEnvVars } from "@/lib/env";
import { getCircuitBreaker } from "@/lib/circuit-breaker";
import { classifyIntegrationErrorClass } from "@/lib/error-classify";
import { logger } from "@/lib/logger";

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
/** Wire-facing id of the primary model; keep in step with `aiModel`. */
const PRIMARY_MODEL_ID = "gpt-4o-mini";
export const aiModel = openai(PRIMARY_MODEL_ID);

/**
 * Fallback chat model for LLM failover (issue #1224).
 *
 * Resolved once at module load, same single-vendor-per-deploy discipline
 * as `INFERENCE_PROVIDER` (`lib/inference.ts`): a deploy picks one
 * fallback id and sticks with it for the process lifetime. Defaults to
 * `gpt-4o` (same vendor, larger tier); `FALLBACK_MODEL` can point it at
 * any model id the Vercel AI SDK supports.
 */
/** Wire-facing ids for the failover log and the route's `model` field. */
export const FALLBACK_PRIMARY_ID = PRIMARY_MODEL_ID;
export const FALLBACK_MODEL_ID = process.env.FALLBACK_MODEL?.trim() || "gpt-4o";

export const aiModelFallback = openai(FALLBACK_MODEL_ID);

/**
 * Whether LLM failover may fire (issue #1224).
 *
 * Reads `LLM_FAILOVER_ENABLED` at call time so tests and a bad deploy
 * can flip it without a code change. Explicit true/false wins; unset
 * defaults ON in production and OFF otherwise, so the dev path stays on
 * the cheap primary and a stray key change cannot burn budget while
 * iterating locally.
 */
export function isLLMFailoverEnabled(): boolean {
  const raw = process.env.LLM_FAILOVER_ENABLED?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return process.env.NODE_ENV === "production";
}

/**
 * Vendor-availability classes: the only failures worth a fallback
 * attempt. `auth` is excluded deliberately — a bad key fails on the
 * fallback too — and `notFound`/`unknown` are excluded so the
 * model-output path (Zod `NoObjectGeneratedError`) never re-runs
 * generation on a bug that a second model would only repeat.
 */
const FAILOVER_ERROR_CLASSES: ReadonlySet<string> = new Set([
  "rateLimit",
  "timeout",
  "network",
]);

export function isProviderAvailabilityFailure(error: unknown): boolean {
  return FAILOVER_ERROR_CLASSES.has(classifyIntegrationErrorClass(error));
}

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
  } catch (error) {
    logger.error(
      {
        event: "ai_error",
        errorType: "ExternalApiError",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      `[ExternalApiError] OpenAI error: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

export interface FailoverAttempt<T> {
  result: T;
  /** Id of the model that produced `result` (e.g. "gpt-4o-mini"). */
  modelId: string;
  /** True when the primary failed on a vendor-availability class and the fallback produced the result. */
  failedOver: boolean;
}

/**
 * Generate with one-shot LLM failover (issue #1224).
 *
 * Runs `run` against the primary `aiModel` through the existing circuit
 * breaker. If that throws a vendor-availability failure (rate limit,
 * timeout, network) and failover is enabled, the same request runs
 * against `aiModelFallback` exactly once, bypassing the breaker — the
 * breaker is OpenAI-scoped and its open state must not short-circuit
 * the escape hatch. Every leg is logged as `generate_copy_failover`
 * with the primary error class and the fallback's outcome so a future
 * ai-debris audit can count how often the fallback fires.
 *
 * `run` receives the model, so the caller shapes the request once and
 * the wrapper only swaps the model handle. Billing stays the caller's
 * single `recordDailyUsage` after resolution, whatever model produced
 * the result.
 */
export async function generateWithFailover<T>(
  run: (model: LanguageModel) => Promise<T>
): Promise<FailoverAttempt<T>> {
  try {
    const result = await generateWithCircuitBreaker(() => run(aiModel));
    return { result, modelId: FALLBACK_PRIMARY_ID, failedOver: false };
  } catch (primaryError) {
    if (!isLLMFailoverEnabled() || !isProviderAvailabilityFailure(primaryError)) {
      throw primaryError;
    }
    const primaryErrorClass = classifyIntegrationErrorClass(primaryError);
    logger.warn(
      {
        event: "generate_copy_failover",
        primaryErrorClass,
        fallbackOutcome: "attempting",
      },
      `[generate_copy_failover] primary failed (${primaryErrorClass}); trying fallback ${FALLBACK_MODEL_ID}`
    );
    try {
      const result = await run(aiModelFallback);
      logger.info(
        {
          event: "generate_copy_failover",
          primaryErrorClass,
          fallbackOutcome: "success",
        },
        `[generate_copy_failover] fallback ${FALLBACK_MODEL_ID} succeeded after primary ${primaryErrorClass}`
      );
      return { result, modelId: FALLBACK_MODEL_ID, failedOver: true };
    } catch (fallbackError) {
      logger.warn(
        {
          event: "generate_copy_failover",
          primaryErrorClass,
          fallbackOutcome: "failed",
          fallbackError:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
        },
        `[generate_copy_failover] fallback ${FALLBACK_MODEL_ID} failed after primary ${primaryErrorClass}`
      );
      throw fallbackError;
    }
  }
}
