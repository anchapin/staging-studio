import * as fal from "@fal-ai/serverless-client";
import { requireEnvVars } from "@/lib/env";
import { getCircuitBreaker } from "@/lib/circuit-breaker";
import { componentLogger } from "@/lib/logger";

const log = componentLogger("fal");

fal.config({
  credentials: process.env.FAL_KEY,
});

/**
 * Configured fal.ai serverless client (namespace re-export).
 *
 * Purpose: the single sanctioned fal.ai entry point. Import `fal` from
 * `@/lib/fal` (see `api/inpaint` for FLUX.1 Fill queue usage); never
 * import `@fal-ai/serverless-client` directly.
 *
 * Side effects at module load: calls `fal.config({ credentials:
 * process.env.FAL_KEY })` — importing this module therefore binds the
 * global fal.ai credentials. If `FAL_KEY` is unset, the client is
 * created unauthenticated and requests fail later; call
 * `assertFalConfigured()` before enqueueing work to fail fast with a
 * clear message. fal.ai result URLs are served from `*.fal.ai`, which is
 * already allowlisted in `next.config.ts` `images.remotePatterns`.
 */
export { fal };

/**
 * Asserts that the fal.ai provider is usable before enqueueing work.
 *
 * Purpose: preflight guard for inpainting routes — throws
 * `MissingEnvVarsError` naming `FAL_KEY` if it is unset or blank.
 *
 * Side effects: reads `process.env.FAL_KEY`; throws when missing.
 */
export function assertFalConfigured(): void {
  requireEnvVars("FAL_KEY");
}

interface FalSubscribeOptions {
  input: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export async function falSubscribeWithCircuitBreaker<T = unknown>(
  modelId: string,
  options: FalSubscribeOptions
): Promise<T> {
  const cb = getCircuitBreaker("fal.ai", {
    failureThreshold: 3,
    cooldownMs: 30_000,
  });
  try {
    return await (cb.execute(() =>
      fal.subscribe(modelId, { ...options })
    ) as Promise<T>);
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const isRetryable = /rate limit|429|503|502|timeout|ECONNREFUSED/i.test(errMessage);
    log.error(
      {
        type: "falai_subscribe_error",
        modelId,
        inputKeys: Object.keys(options.input ?? {}),
        error: errMessage,
        retryable: isRetryable,
        fallback: "circuit_breaker_open",
      },
      `fal.ai subscribe failed for ${modelId}: ${errMessage}`
    );
    throw err;
  }
}

interface FalQueueSubmitOptions {
  input: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export async function falQueueSubmitWithCircuitBreaker(
  modelId: string,
  options: FalQueueSubmitOptions
): Promise<{ request_id: string }> {
  const cb = getCircuitBreaker("fal.ai", {
    failureThreshold: 3,
    cooldownMs: 30_000,
  });
  try {
    return await (cb.execute(() =>
      fal.queue.submit(modelId, options)
    ) as Promise<{ request_id: string }>);
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const isRetryable = /rate limit|429|503|502|timeout|ECONNREFUSED/i.test(errMessage);
    log.error(
      {
        type: "falai_queue_submit_error",
        modelId,
        inputKeys: Object.keys(options.input ?? {}),
        error: errMessage,
        retryable: isRetryable,
        fallback: "circuit_breaker_open",
      },
      `fal.ai queue.submit failed for ${modelId}: ${errMessage}`
    );
    throw err;
  }
}
