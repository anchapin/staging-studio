/**
 * Provider-agnostic inference abstraction.
 *
 * Purpose: decouple the inpainting pipeline from any single remote
 * inference provider. Today the project calls fal.ai (`@fal-ai/client`)
 * for both FLUX.1 Fill (inpaint) and SAM 3.1 (furnishings detection);
 * the abstraction lets us swap providers (e.g. to Replicate) without
 * touching every call site, by selecting the implementation at module
 * load via `INFERENCE_PROVIDER` (defaults to `fal`).
 *
 * Why a flag and not per-call-site provider choice: in production we
 * run a single provider at a time. The flag is for incidents and A/B
 * tests, not for splitting traffic on a per-request basis. Adding a
 * per-request provider later is a non-breaking change — the
 * `InferenceClient` interface stays the same.
 *
 * Each adapter implements the same four-method surface:
 * - `subscribe<T>(modelId, options)` — one-shot call that returns when
 *   the model has produced a result. Used for synchronous-ish models
 *   like SAM 3.1 (single call, polled internally by the provider).
 * - `submit(modelId, options)` — enqueue a job. Returns a provider
 *   request id (renamed to `request_id` in this interface so the
 *   caller doesn't care which provider made it).
 * - `status(modelId, requestId)` — poll the queue for a non-terminal
 *   job. Returns a normalized status that the rest of the pipeline
 *   already understands (`IN_QUEUE` | `IN_PROGRESS` | `COMPLETED` |
 *   `ERROR`).
 * - `result(modelId, requestId)` — fetch the final output of a
 *   completed job. The shape is the raw model output (no provider
 *   envelope), so call sites can keep their parsers.
 *
 * Pure logic. Side effects: each adapter binds its own client at
 * module load (e.g. `fal.config(...)`); the `inference.ts` import is
 * a no-op until a method is called.
 */

import { requireEnvVars } from "@/lib/env";

// ─── Logical model names ────────────────────────────────────────────────────
// Call sites pass these strings; the adapter resolves them to a
// provider-specific model id. Keeping them in one place makes the
// "what models does this app use?" question trivial to answer.
export const LOGICAL_MODEL = {
  /** FLUX.1 Fill (inpaint) — the restage-furnishings model. */
  FLUX_FILL: "flux-fill",
  /** SAM 3.1 image — text-prompted instance segmentation. */
  SAM_3_1_IMAGE: "sam-3-1-image",
} as const;

export type LogicalModel = (typeof LOGICAL_MODEL)[keyof typeof LOGICAL_MODEL];

// ─── Provider selection ────────────────────────────────────────────────────

export type InferenceProviderName = "fal" | "replicate";

/**
 * Resolves the active provider from `INFERENCE_PROVIDER`. Defaults to
 * `fal` when unset or empty, which keeps today's behavior identical
 * for any deploy that has not opted in. Side effects: reads
 * `process.env` only.
 */
export function resolveProvider(): InferenceProviderName {
  const raw = process.env.INFERENCE_PROVIDER?.trim().toLowerCase();
  if (raw === "replicate") return "replicate";
  // `fal` is the default for any other value, including unset. A typo
  // in the env (e.g. `INFERENCE_PROVIDER=falk`) is intentionally
  // ignored — silent fall-through to fal beats a hard fail on
  // production deploys; the warning is logged once below.
  if (raw && raw !== "fal") {
    // eslint-disable-next-line no-console
    console.warn(
      `[inference] Unknown INFERENCE_PROVIDER="${raw}"; falling back to "fal". Valid: fal, replicate.`
    );
  }
  return "fal";
}

// ─── Normalized status ─────────────────────────────────────────────────────
// Adapters translate their provider-specific status string into one of
// these five. The status route, the inpaint poller, and the React
// client already agree on this vocabulary, so the rest of the system
// doesn't have to know which provider produced it.
export type NormalizedStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "ERROR";

/** Status fetch — non-2xx, abort, or 404 is the caller's problem. */
export interface InferenceStatusResult {
  status: NormalizedStatus;
  /** Provider-specific extras, e.g. queue position. Not used today. */
  raw?: unknown;
}

/** Result fetch — call only when status is `COMPLETED`. */
export interface InferenceResultResult<T = unknown> {
  /** Raw model output (no provider envelope). The `data` wrapper is
   * an artifact of `@fal-ai/client`'s `Result<T>` type — Replicate
   * returns the output directly, so adapters unwrap accordingly. */
  data: T;
}

// ─── Interface ─────────────────────────────────────────────────────────────

export interface SubscribeOptions {
  input: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

// ─── Logical inpaint input ──────────────────────────────────────────────────

/**
 * UI-facing input for the inpaint (FLUX.1 Fill) model. The provider
 * adapters translate this to their wire format (fal: snake_case;
 * Replicate: shorter keys). Call sites that have already translated
 * their UI values into this shape can use `submitInpaint` below
 * without knowing which provider is active.
 */
export interface LogicalInpaintInput {
  imageUrl: string;
  maskUrl: string;
  prompt: string;
  negativePrompt?: string;
  /** 0.1–1.0, scaled to the provider's guidance range. */
  promptStrength?: number;
  maskBlur?: number;
  seed?: number;
  creativeMode?: boolean;
}

// ─── Client selection ──────────────────────────────────────────────────────

export interface InferenceClient {
  /**
   * One-shot call: subscribes to the model's stream (or polls
   * internally) and returns the raw model output. Used for models
   * with a single round-trip semantic like SAM 3.1.
   */
  subscribe<T = unknown>(
    logicalModel: LogicalModel,
    options: SubscribeOptions
  ): Promise<T>;

  /**
   * Enqueue a long-running job. Takes a pre-formatted
   * provider-neutral payload. Call sites build the payload using
   * the provider-specific helper (`buildFalFillPayload` today;
   * `buildReplicateFillPayload` for the Replicate path) — payload
   * schemas differ between providers, so the abstraction does not
   * try to normalize them. Returns a provider-agnostic
   * `request_id` string the caller passes back to `status` /
   * `result`.
   */
  submit(
    logicalModel: LogicalModel,
    options: SubscribeOptions
  ): Promise<{ request_id: string }>;

  /**
   * Poll the queue for a non-terminal job. The provider-specific
   * status is normalized to the `NormalizedStatus` union so the rest
   * of the system can be provider-agnostic.
   */
  status(
    logicalModel: LogicalModel,
    requestId: string
  ): Promise<InferenceStatusResult>;

  /**
   * Fetch the final output of a completed job. Returns the raw model
   * output (no provider envelope). Throws if the job isn't
   * `COMPLETED` yet.
   */
  result<T = unknown>(
    logicalModel: LogicalModel,
    requestId: string
  ): Promise<InferenceResultResult<T>>;
}

// ─── Provider-agnostic 404 detection ───────────────────────────────────────

/**
 * Thrown by an adapter's `status` / `result` when the provider
 * reports the requestId is no longer known (HTTP 404). The status
 * route catches this and transitions the row to ERROR so the poller
 * terminates (#1187 follow-up). Each adapter normalizes its
 * provider-specific error into this single shape; callers don't have
 * to know whether they're talking to fal, Replicate, or a future
 * provider.
 */
export class InferenceRequestGoneError extends Error {
  readonly provider: InferenceProviderName;
  readonly originalStatus: number;
  constructor(
    provider: InferenceProviderName,
    originalStatus: number,
    message?: string
  ) {
    super(
      message ??
        `${provider} reports the request is gone (HTTP ${originalStatus})`
    );
    this.name = "InferenceRequestGoneError";
    this.provider = provider;
    this.originalStatus = originalStatus;
  }
}

// ─── Client selection ──────────────────────────────────────────────────────

/**
 * Pre-flight check that the active provider is configured. Throws
 * `MissingEnvVarsError` naming the right env var for the active
 * provider (FAL_KEY or REPLICATE_API_TOKEN). Call this before
 * enqueueing work so a misconfiguration surfaces as a clear error
 * instead of a downstream provider auth failure. Side effects: reads
 * `process.env`.
 */
export function assertInferenceConfigured(): void {
  if (resolveProvider() === "replicate") {
    requireEnvVars("REPLICATE_API_TOKEN");
  } else {
    requireEnvVars("FAL_KEY");
  }
}

let cachedClient: InferenceClient | null = null;

/**
 * Returns the active `InferenceClient`, instantiating it on the first
 * call. The active client is selected by `resolveProvider()` at
 * module load — flipping `INFERENCE_PROVIDER` requires a process
 * restart. Side effects: imports `@/lib/fal-adapter` or
 * `@/lib/replicate-adapter` (transitively binding whichever provider
 * is active).
 */
export async function getInferenceClient(): Promise<InferenceClient> {
  if (cachedClient) return cachedClient;
  const provider = resolveProvider();
  if (provider === "replicate") {
    const { createReplicateClient } = await import("@/lib/replicate-adapter");
    cachedClient = createReplicateClient();
  } else {
    const { createFalClient } = await import("@/lib/fal-adapter");
    cachedClient = createFalClient();
  }
  return cachedClient;
}

/**
 * Resets the cached client. Test-only — production code never
 * re-selects the provider. Side effects: clears the module-level
 * `cachedClient`.
 */
export function _resetInferenceClientForTests(): void {
  cachedClient = null;
}
