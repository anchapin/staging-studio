/**
 * fal.ai adapter for the inference abstraction.
 *
 * Reuses the existing `@/lib/fal` client singleton + circuit-breaker
 * wrappers. The wrappers already enforce the same shape the abstraction
 * needs (Result envelope unwrap, narrow `request_id` return). This
 * file is a thin shim: the only work it does is translate the
 * abstraction's `LogicalModel` to a fal-specific model id, and the
 * provider's queue status to the `NormalizedStatus` union.
 *
 * The fal client itself stays in `src/lib/fal.ts` so existing imports
 * (route handlers, tests, the spend-guard regex) keep working without
 * a re-shuffle. Adding a new logical model means adding a row to
 * `LOGICAL_MODEL_TO_FAL` below — nothing else.
 */
import {
  fal,
  falQueueSubmitWithCircuitBreaker,
  falSubscribeWithCircuitBreaker,
  unwrapFalResult,
  FalApiError,
} from "@/lib/fal";
import { logger } from "@/lib/logger";
import {
  InferenceRequestGoneError,
  LOGICAL_MODEL,
  type InferenceClient,
  type InferenceStatusResult,
  type LogicalModel,
  type NormalizedStatus,
} from "@/lib/inference";

/**
 * Detects "the queue no longer knows this requestId" and re-throws
 * as `InferenceRequestGoneError` so the abstraction's `status` /
 * `result` callers can handle all providers with one `instanceof`
 * check. Anything else is re-thrown unchanged. Side effects: none.
 */
function rethrowFalGone(error: unknown): never {
  if (error instanceof FalApiError && error.status === 404) {
    throw new InferenceRequestGoneError("fal", 404, error.message);
  }
  throw error as Error;
}

/**
 * Maps a logical model name to fal's model id. The two columns of the
 * project that spend fal money (inpaint, segmentation) live here so
 * the call sites can stay abstract.
 */
const LOGICAL_MODEL_TO_FAL: Record<LogicalModel, string> = {
  [LOGICAL_MODEL.FLUX_FILL]: "fal-ai/flux-lora-fill",
  // SAM 3.1 is exposed on fal as `fal-ai/sam-3-1/image`. The legacy
  // `fal-ai/sam` model is gone (retirement #236); the spend-guard
  // asserts no src/ file references it.
  [LOGICAL_MODEL.SAM_3_1_IMAGE]: "fal-ai/sam-3-1/image",
};

/** fal's QueueStatus -> NormalizedStatus. See
 * `@fal-ai/client/src/types/common.d.ts` for the source-of-truth. */
function normalizeFalStatus(raw: string): NormalizedStatus {
  switch (raw) {
    case "IN_QUEUE":
      return "IN_QUEUE";
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "COMPLETED":
      return "COMPLETED";
    default:
      // "ERROR" is the only other value fal returns, but a future
      // fal-side addition shouldn't crash the poller.
      return "ERROR";
  }
}

/**
 * Creates the fal-backed `InferenceClient`. Module-load side effects
 * (binding `fal.config({ credentials })`) happen when `@/lib/fal` is
 * first imported; this constructor itself is allocation-only.
 */
export function createFalClient(): InferenceClient {
  return {
    async subscribe<T>(logicalModel: LogicalModel, options: {
      input: Record<string, unknown>;
      abortSignal?: AbortSignal;
    }): Promise<T> {
      const modelId = LOGICAL_MODEL_TO_FAL[logicalModel];
      if (!modelId) {
        throw new Error(
          `fal adapter: unknown logical model "${logicalModel}". ` +
            `Add it to LOGICAL_MODEL_TO_FAL.`
        );
      }
      try {
        // `falSubscribeWithCircuitBreaker` already unwraps the
        // `Result<T>` envelope (issue #1192) and routes through the
        // shared circuit breaker. The abstraction's `subscribe`
        // returns the raw model output T directly.
        return (await falSubscribeWithCircuitBreaker<T>(modelId, options)) as T;
      } catch (error) {
        logger.error(
          {
            event: "inference_error",
            provider: "fal",
            logicalModel,
            modelId,
            error: error instanceof Error ? error.message : String(error),
          },
          `[inference] fal subscribe error: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    },

    async submit(
      logicalModel: LogicalModel,
      options: { input: Record<string, unknown>; abortSignal?: AbortSignal }
    ): Promise<{ request_id: string }> {
      const modelId = LOGICAL_MODEL_TO_FAL[logicalModel];
      if (!modelId) {
        throw new Error(
          `fal adapter: unknown logical model "${logicalModel}". ` +
            `Add it to LOGICAL_MODEL_TO_FAL.`
        );
      }
      return falQueueSubmitWithCircuitBreaker(modelId, options);
    },

    async status(
      _logicalModel: LogicalModel,
      requestId: string
    ): Promise<InferenceStatusResult> {
      // The status route in `src/app/api/inpaint/[requestId]/status`
      // hard-codes the fal model id because the inpaint model is the
      // only thing that uses the queue today. Once the abstraction
      // reaches the status route, the model id can come from the row
      // (a new column) or the `logicalModel` parameter. For v1 we
      // ignore the parameter and use the inpaint model id directly,
      // matching the prior behavior exactly.
      const modelId = LOGICAL_MODEL_TO_FAL[LOGICAL_MODEL.FLUX_FILL];
      let raw: Awaited<ReturnType<typeof fal.queue.status>>;
      try {
        raw = await fal.queue.status(modelId, { requestId });
      } catch (error) {
        rethrowFalGone(error);
      }
      return {
        status: normalizeFalStatus(raw.status),
        raw,
      };
    },

    async result<T = unknown>(
      _logicalModel: LogicalModel,
      requestId: string
    ): Promise<{ data: T }> {
      // Same v1 simplification: inpaint is the only queue user.
      const modelId = LOGICAL_MODEL_TO_FAL[LOGICAL_MODEL.FLUX_FILL];
      // `fal.queue.result` already returns `Result<T>` (an envelope),
      // and `unwrapFalResult` strips it. The abstraction's `result`
      // returns the raw output.
      let raw: { data: T } | null;
      try {
        raw = (await fal.queue.result(modelId, { requestId })) as {
          data: T;
        } | null;
      } catch (error) {
        rethrowFalGone(error);
      }
      if (!raw) {
        throw new Error(
          `fal adapter: result endpoint returned null for requestId ${requestId}`
        );
      }
      return { data: unwrapFalResult<T>(raw) };
    },
  };
}

// Re-export so existing call sites that do `import { FalApiError }`
// from `@/lib/fal-adapter` (after a future refactor) don't break.
export type { FalApiError };
