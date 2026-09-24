import { generateObject, GenerateObjectResult } from "ai";
import { openai } from "@ai-sdk/openai";
import { requireEnvVars } from "@/lib/env";
import { getCircuitBreaker } from "@/lib/circuit-breaker";

const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 10000;
const MAX_RETRIES = 3;

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("rate_limit") ||
      message.includes("429") ||
      message.includes("500") ||
      message.includes("502") ||
      message.includes("503") ||
      message.includes("504") ||
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("ECONNRESET") ||
      message.includes("ETIMEDOUT")
    ) {
      return true;
    }
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function calculateBackoff(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number
): Promise<number> {
  const exponentialDelay = initialDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 1000;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

export async function generateWithRetry<T extends Record<string, unknown>>(
  params: Parameters<typeof generateObject>[0],
  options: RetryOptions = {}
): Promise<GenerateObjectResult<T>> {
  const {
    maxRetries = MAX_RETRIES,
    initialDelayMs = INITIAL_RETRY_DELAY_MS,
    maxDelayMs = MAX_RETRY_DELAY_MS,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await generateObject(params) as GenerateObjectResult<T>;
    } catch (error) {
      lastError = error;

      if (attempt > maxRetries) {
        break;
      }

      if (!isRetryableError(error)) {
        throw error;
      }

      const delay = await calculateBackoff(attempt, initialDelayMs, maxDelayMs);
      await sleep(delay);
    }
  }

  throw lastError;
}

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
  return cb.execute(fn);
}
