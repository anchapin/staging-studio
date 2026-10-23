/**
 * Provider-agnostic inference abstraction.
 *
 * Purpose: decouple the inpainting pipeline from any single remote
 * inference provider. As of #1240 the only wired provider is Alibaba
 * Cloud DashScope (`qwen-image-2.1-pro`); the `fal` and `replicate`
 * adapters were retired (their modules deleted, their `INFERENCE_PROVIDER`
 * values are accepted by the parser but rejected at configure time with a
 * clear error). Adding a future provider (Together, Stability, etc.) is
 * a new adapter file plus one switch arm in `resolveProvider` /
 * `getInferenceClient` — the `InferenceClient` interface stays the same.
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
 * module load (e.g. `fal.config(...)` for the legacy fal path, or
 * `requireAlibabaEnv()` for DashScope); the `inference.ts` import is
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

/**
 * The literal `"alibaba"` is the only wired provider as of #1240. The
 * `fal | replicate` strings remain in this union so an operator that
 * sets `INFERENCE_PROVIDER=fal|replicate` gets a clear error from
 * `assertInferenceConfigured` / `getInferenceClient` instead of a
 * runtime import failure when those modules were deleted. Once a
 * future provider is added, drop its literal in here too.
 */
export type InferenceProviderName = "alibaba" | "fal" | "replicate";

/**
 * Resolves the active provider from `INFERENCE_PROVIDER`. Defaults to
 * `alibaba` (the production inpaint provider as of #1240) when unset
 * or empty. Side effects: reads `process.env` only.
 */
export function resolveProvider(): InferenceProviderName {
  const raw = process.env.INFERENCE_PROVIDER?.trim().toLowerCase();
  if (raw === "fal") return "fal";
  if (raw === "replicate") return "replicate";
  if (raw === "alibaba") return "alibaba";
  // `alibaba` is the default for any other value, including unset. A typo
  // in the env (e.g. `INFERENCE_PROVIDER=Alibaba` after a case mismatch)
  // is intentionally ignored — silent fall-through to alibaba beats a
  // hard fail on production deploys; the warning is logged once below.
  if (raw) {
    console.warn(
      `[inference] Unknown INFERENCE_PROVIDER="${raw}"; falling back to "alibaba". Valid: alibaba.`,
    );
  }
  return "alibaba";
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
  /**
   * Optional completion webhook URL (issue #1221). Set only when
   * `INFERENCE_DELIVERY=webhook`: fal receives `webhook`, Replicate
   * `webhook` + `events_filter`. Unset keeps the polling path
   * byte-identical.
   */
  webhookUrl?: string;
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
  /**
   * Issue #1362b: AI guidance strength. Renamed from `promptStrength`
   * to match DashScope's `parameters.strength` wire field. Range is
   * 0.0–1.0 (DashScope's wire default is 0.5). The numeric mapping
   * to the fal / Replicate guidance range (1–10) is byte-equivalent
   * to the legacy `promptStrength * 10` expression.
   */
  strength?: number;
  /**
   * Issue #1362b: reproducible seed for iteration (0–999999). Omit
   * for random. The alibaba-adapter threads this through to
   * `parameters.seed`; fal / Replicate carry it as `seed`.
   */
  seed?: number;
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
   *
   * For **synchronous** providers (e.g. Alibaba DashScope, where one
   * round-trip returns the final image URL), the returned object also
   * carries a populated `result` so the route handler can persist the
   * durable result URL alongside the row write in the same request
   * (#1240 multi-instance fix). Async providers (fal queue, Replicate
   * prediction) leave `result` undefined and the poller fills the
   * durable URL on a later poll.
   */
  submit(
    logicalModel: LogicalModel,
    options: SubscribeOptions
  ): Promise<{
    request_id: string;
    result?: { imageUrl: string; width: number | null; height: number | null };
  }>;

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

  /**
   * OPTIONAL: cancel a job the app can no longer map to a durable
   * result (issue #1421).
   *
   * Used by the inpaint route's post-submit write-failure path: the
   * provider accepted (and billed) the job, but the DB write failed, so
   * the result would be invisible — cancelling upstream is the only way
   * to stop the money.
   *
   * Providers WITHOUT a cancel API simply do not implement this method
   * (the interface member is optional). Callers must therefore treat a
   * missing `cancel` as "no cancel possible" and record the provider
   * cost as a known-cost write-off instead of crashing.
   */
  cancel?(
    logicalModel: LogicalModel,
    requestId: string
  ): Promise<InferenceCancelResult>;
}

/**
 * Outcome of a provider-side cancel attempt (issue #1421).
 *
 * `cancelled: false` does NOT mean the attempt failed — it can also
 * mean the provider has no cancellable job (e.g. a synchronous API that
 * already completed and was billed). `reason` explains which.
 */
export interface InferenceCancelResult {
  /** True when the provider confirmed the job was cancelled. */
  cancelled: boolean;
  /** Machine-readable explanation (logged for cost accounting). */
  reason: string;
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
 * `MissingEnvVarsError` naming the right env vars for the active
 * provider. Call this before enqueueing work so a misconfiguration
 * surfaces as a clear error instead of a downstream provider auth
 * failure. Side effects: reads `process.env`.
 */
export function assertInferenceConfigured(): void {
  // The fal and replicate adapters were retired in #1240 — production
  // runs Alibaba. Selecting either of the legacy values still parses
  // (so a stale `INFERENCE_PROVIDER=fal` in a deploy logs a clear error
  // instead of silently falling through to Alibaba), but throws on
  // configure so a misconfigured deploy fails fast.
  const provider = resolveProvider();
  if (provider === "replicate" || provider === "fal") {
    throw new Error(
      `INFERENCE_PROVIDER="${provider}" is no longer supported after #1240. ` +
        `Use "alibaba" (default).`,
    );
  }
  // Inline the env-var list (rather than importing alibaba-adapter)
  // to avoid a circular import -- alibaba-adapter imports
  // `InferenceClient` from here. `assertAlibabaConfigured` in
  // `lib/alibaba-adapter.ts` is the canonical helper for callers that
  // don't go through the abstraction.
  requireEnvVars(
    "ALIBABA_DASHSCOPE_API_KEY",
    "ALIBABA_BAILIAN_WORKSPACE_ID",
    "ALIBABA_INPAINT_MODEL",
  );
}

let cachedClient: InferenceClient | null = null;

/**
 * Returns the active `InferenceClient`, instantiating it on the first
 * call. As of #1240 the only wired provider is Alibaba Cloud (DashScope).
 * Side effects: imports `@/lib/alibaba-adapter` on first call.
 */
export async function getInferenceClient(): Promise<InferenceClient> {
  if (cachedClient) return cachedClient;
  const provider = resolveProvider();
  if (provider === "replicate" || provider === "fal") {
    // Mirror assertInferenceConfigured: refuse to silently fall back
    // when an operator flips to a retired provider. The error is loud,
    // not silent, because the right action is to update INFERENCE_PROVIDER.
    throw new Error(
      `INFERENCE_PROVIDER="${provider}" is no longer supported after #1240. ` +
        `Use "alibaba" (default).`,
    );
  }
  const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
  cachedClient = createAlibabaClient();
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
