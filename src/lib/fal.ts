import { fal } from "@fal-ai/client";
import { requireEnvVars } from "@/lib/env";
import {
  getCircuitBreaker,
} from "@/lib/circuit-breaker";
import { logger } from "@/lib/logger";

fal.config({
  credentials: process.env.FAL_KEY,
});

/**
 * Configured fal.ai serverless client (namespace re-export).
 *
 * Purpose: the single sanctioned fal.ai entry point. Import `fal` from
 * `@/lib/fal` (see `api/inpaint` for FLUX.1 Fill queue usage); never
 * import `@fal-ai/client` directly.
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
    // `@fal-ai/client@1.x`'s `subscribe()` resolves to `Result<T>` (data +
    // requestId), not `T` directly. We widen through unknown before
    // re-narrowing to the call-site `T` so callers continue to receive the
    // payload as if it were the raw result.
    return (await cb.execute(() =>
      fal.subscribe(modelId, { ...options })
    )) as unknown as Promise<T>;
  } catch (error) {
    logger.error(
      {
        event: "fal_error",
        errorType: "ExternalApiError",
        modelId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      `[ExternalApiError] fal.ai subscribe error: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
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
    // `@fal-ai/client@1.x` returns a richer `InQueueQueueStatus`; we keep
    // the narrow `{ request_id: string }` shape because every caller only
    // reads `request_id`. The cast widens the typed result through unknown
    // before re-narrowing to the call-site shape.
    return await cb.execute(() =>
      fal.queue.submit(modelId, options) as unknown as Promise<{
        request_id: string;
      }>
    );
  } catch (error) {
    logger.error(
      {
        event: "fal_error",
        errorType: "ExternalApiError",
        modelId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      `[ExternalApiError] fal.ai queue submit error: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}
