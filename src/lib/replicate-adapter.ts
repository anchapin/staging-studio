/**
 * Replicate adapter for the inference abstraction.
 *
 * Replicate is a REST API, so this adapter is built on `fetch` rather
 * than an SDK — no new package dependency. The HTTP endpoints used are
 * `POST /v1/predictions` (submit) and `GET /v1/predictions/{id}`
 * (status + result). See https://replicate.com/docs/topics/predictions
 * for the wire format.
 *
 * The adapter is selected when `INFERENCE_PROVIDER=replicate` and is
 * a no-op until a method is called. `REPLICATE_API_TOKEN` is read at
 * module load; an unset token is allowed for unit tests that mock
 * `globalThis.fetch` (the real token is only consulted when the
 * adapter actually issues an HTTP call).
 *
 * Status mapping (Replicate -> NormalizedStatus):
 *   starting   -> IN_QUEUE
 *   processing -> IN_PROGRESS
 *   succeeded  -> COMPLETED
 *   failed     -> ERROR
 *   canceled   -> ERROR
 */
import { requireEnvVars } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  InferenceRequestGoneError,
  LOGICAL_MODEL,
  type InferenceClient,
  type InferenceStatusResult,
  type LogicalModel,
  type NormalizedStatus,
} from "@/lib/inference";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";

/**
 * Maps logical model names to Replicate's `{ owner/name }` model id
 * strings. The values chosen here are FLUX.1 Fill Pro
 * (`black-forest-labs/flux-fill-pro`) and a text-prompted SAM
 * (`lucataco/sam-2-text`). Override per-deploy via env
 * (`REPLICATE_FLUX_FILL_MODEL`, `REPLICATE_SAM_MODEL`) without code
 * changes — same model identity, different host.
 */
function resolveReplicateModel(logical: LogicalModel): string {
  switch (logical) {
    case LOGICAL_MODEL.FLUX_FILL: {
      return (
        process.env.REPLICATE_FLUX_FILL_MODEL?.trim() ||
        "black-forest-labs/flux-fill-pro"
      );
    }
    case LOGICAL_MODEL.SAM_3_1_IMAGE: {
      return (
        process.env.REPLICATE_SAM_MODEL?.trim() ||
        "lucataco/sam-2-text"
      );
    }
    default: {
      // exhaustiveness guard — adding a logical model without a
      // Replicate model id is a programming error.
      const _exhaustive: never = logical;
      throw new Error(
        `Replicate adapter: unknown logical model "${String(logical)}". ` +
          `Add a case to resolveReplicateModel.`
      );
    }
  }
}

/** Replicate's prediction lifecycle string -> NormalizedStatus. */
function normalizeReplicateStatus(raw: string): NormalizedStatus {
  switch (raw) {
    case "starting":
      return "IN_QUEUE";
    case "processing":
      return "IN_PROGRESS";
    case "succeeded":
      return "COMPLETED";
    case "failed":
    case "canceled":
      return "ERROR";
    default:
      // Future-proof: an unknown status is conservatively treated as
      // ERROR rather than letting the poller loop on garbage.
      return "ERROR";
  }
}

interface ReplicatePrediction {
  id: string;
  status: string;
  output: unknown;
  error: string | null;
}

/**
 * Errors thrown by the Replicate adapter. Carries the HTTP status and
 * the response body so callers (`inpaint-status.ts` 404 detection) can
 * distinguish a queue-pruned request from a transient failure.
 */
export class ReplicateApiError extends Error {
  readonly httpStatus: number;
  readonly body: unknown;
  constructor(httpStatus: number, message: string, body?: unknown) {
    super(message);
    this.name = "ReplicateApiError";
    this.httpStatus = httpStatus;
    this.body = body;
  }
}

/** Resolves a Replicate API token, falling back to env. */
function getReplicateToken(): string {
  return process.env.REPLICATE_API_TOKEN?.trim() || requireEnvVars("REPLICATE_API_TOKEN").REPLICATE_API_TOKEN;
}

/**
 * Issues a Replicate REST call. Pure HTTP, no SDK. Throws
 * `InferenceRequestGoneError` on HTTP 404 (the prediction no longer
 * exists, typically because the queue TTL elapsed) so the abstraction
 * callers can recognize "phantom job" without parsing Replicate's
 * error envelope. Throws `ReplicateApiError` for every other non-2xx.
 */
async function replicateFetch(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; token: string }
): Promise<ReplicatePrediction> {
  const url = `${REPLICATE_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.token}`,
    "Content-Type": "application/json",
  };
  const response = await fetch(url, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // body is best-effort; non-JSON error responses are fine.
    }
    const message =
      (body && typeof body === "object" && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : null) || `Replicate ${init.method} ${path} returned ${response.status}`;
    if (response.status === 404) {
      throw new InferenceRequestGoneError(
        "replicate",
        404,
        `Replicate prediction ${path} not found`
      );
    }
    throw new ReplicateApiError(response.status, message, body);
  }
  return (await response.json()) as ReplicatePrediction;
}

/**
 * Creates the Replicate-backed `InferenceClient`. Side effects: only
 * the env reads on the first call. Token presence is checked lazily
 * inside the HTTP helper so unit tests can mock `fetch` without
 * setting a real token.
 */
export function createReplicateClient(): InferenceClient {
  return {
    async subscribe<T>(logicalModel: LogicalModel, options: {
      input: Record<string, unknown>;
      abortSignal?: AbortSignal;
    }): Promise<T> {
      const token = getReplicateToken();
      const modelId = resolveReplicateModel(logicalModel);
      try {
        // Replicate has no streaming subscribe equivalent on the REST
        // API; we submit and poll until terminal. This matches fal's
        // single-round-trip pattern: the caller gets one resolved
        // promise at the end. Async abort is best-effort (Replicate's
        // cancel API needs a separate call).
        const submitResult = await replicateFetch("/predictions", {
          method: "POST",
          token,
          body: { model: modelId, input: options.input },
        });
        if (options.abortSignal?.aborted) {
          throw new Error("replicate subscribe aborted before completion");
        }
        // Poll until terminal. 60s timeout per the sync-mode default
        // is a reasonable upper bound; longer models (FLUX.1 Fill is
        // typically <30s) can be retried by the route handler. This
        // is intentionally NOT the same as the route's 5-minute
        // wall-clock cap — the route handles the outer polling.
        const prediction = await pollUntilTerminal(
          submitResult.id,
          token,
          options.abortSignal
        );
        if (prediction.status !== "succeeded") {
          throw new Error(
            `Replicate prediction ${prediction.id} ended with status ${prediction.status}: ${prediction.error ?? "no error message"}`
          );
        }
        return prediction.output as T;
      } catch (error) {
        logger.error(
          {
            event: "inference_error",
            provider: "replicate",
            logicalModel,
            modelId,
            error: error instanceof Error ? error.message : String(error),
          },
          `[inference] replicate subscribe error: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    },

    async submit(
      logicalModel: LogicalModel,
      options: { input: Record<string, unknown>; abortSignal?: AbortSignal }
    ): Promise<{ request_id: string }> {
      const token = getReplicateToken();
      const modelId = resolveReplicateModel(logicalModel);
      const result = await replicateFetch("/predictions", {
        method: "POST",
        token,
        body: { model: modelId, input: options.input },
      });
      return { request_id: result.id };
    },

    async status(
      _logicalModel: LogicalModel,
      requestId: string
    ): Promise<InferenceStatusResult> {
      const token = getReplicateToken();
      const prediction = await replicateFetch(
        `/predictions/${encodeURIComponent(requestId)}`,
        { method: "GET", token }
      );
      return {
        status: normalizeReplicateStatus(prediction.status),
        raw: prediction,
      };
    },

    async result<T = unknown>(
      _logicalModel: LogicalModel,
      requestId: string
    ): Promise<{ data: T }> {
      const token = getReplicateToken();
      const prediction = await replicateFetch(
        `/predictions/${encodeURIComponent(requestId)}`,
        { method: "GET", token }
      );
      if (prediction.status !== "succeeded") {
        throw new Error(
          `Replicate prediction ${requestId} not succeeded: status=${prediction.status}`
        );
      }
      return { data: prediction.output as T };
    },
  };
}

/**
 * Polls a Replicate prediction until it reaches a terminal state.
 * Throws on ReplicateApiError (including 404 — the queue may have
 * pruned the request). Caller is expected to handle the abort signal
 * between polls; this loop checks it on every iteration. The poll
 * cadence (1s, 2s, 4s, 8s, capped at 8s — short ceiling because
 * `subscribe` is a synchronous facade) is intentionally aggressive
 * because the inpaint route has its own outer polling loop and we
 * want the subscribe result fast.
 */
async function pollUntilTerminal(
  predictionId: string,
  token: string,
  abortSignal?: AbortSignal
): Promise<ReplicatePrediction> {
  let delayMs = 1_000;
  const maxDelayMs = 8_000;
  // Hard cap at 90s so a hung Replicate job fails fast and the
  // caller's circuit breaker / outer polling can take over.
  const startedAt = Date.now();
  const maxWaitMs = 90_000;
  for (;;) {
    if (abortSignal?.aborted) {
      throw new Error("replicate poll aborted");
    }
    if (Date.now() - startedAt >= maxWaitMs) {
      throw new Error(
        `replicate poll exceeded ${maxWaitMs}ms waiting for ${predictionId}`
      );
    }
    const prediction = await replicateFetch(
      `/predictions/${encodeURIComponent(predictionId)}`,
      { method: "GET", token }
    );
    if (
      prediction.status === "succeeded" ||
      prediction.status === "failed" ||
      prediction.status === "canceled"
    ) {
      return prediction;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }
}
