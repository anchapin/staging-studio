import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { decideInpaintPersistence } from "@/lib/inpaint-persistence";
import { classifyIntegrationError } from "@/lib/error-classify";
import {
  getInferenceClient,
  InferenceRequestGoneError,
  LOGICAL_MODEL,
} from "@/lib/inference";
import {
  API_ERROR_INPAINT_STATUS_FAILED,
  API_ERROR_INPAINT_TERMINAL,
  API_ERROR_REQUEST_NOT_FOUND,
} from "@/lib/api-errors";

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export const INPAINT_STATUS_RATE_LIMIT = 10;
const INPAINT_STATUS_RATE_WINDOW_MS = 60_000;

type RateLimitEntry = { count: number; windowStart: number };

const inpaintStatusRateLimitMap = new Map<string, RateLimitEntry>();

/** Test-only: clear the in-memory limiter so route tests don't trip it. */
export function _resetInpaintStatusRateLimitForTests(): void {
  inpaintStatusRateLimitMap.clear();
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Sliding-window rate limiter for inpaint status polling. Tracks (userId, requestId)
 * to prevent a client from hammering a single inpaint request.
 */
export function checkInpaintStatusRateLimit(
  userId: string,
  requestId: string
): RateLimitResult {
  const now = Date.now();
  const key = `${userId}:${requestId}`;
  const entry = inpaintStatusRateLimitMap.get(key);

  if (!entry || now - entry.windowStart >= INPAINT_STATUS_RATE_WINDOW_MS) {
    inpaintStatusRateLimitMap.set(key, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: INPAINT_STATUS_RATE_LIMIT - 1,
      retryAfterSeconds: 60,
    };
  }

  if (entry.count >= INPAINT_STATUS_RATE_LIMIT) {
    const retryAfterSeconds = Math.ceil(
      (INPAINT_STATUS_RATE_WINDOW_MS - (now - entry.windowStart)) / 1000
    );
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: INPAINT_STATUS_RATE_LIMIT - entry.count,
    retryAfterSeconds: Math.ceil(
      (INPAINT_STATUS_RATE_WINDOW_MS - (now - entry.windowStart)) / 1000
    ),
  };
}

// ─── Error Copy ───────────────────────────────────────────────────────────────

const INPAINT_STATUS_ERROR_COPY = {
  notFound: {
    error: "Request not found",
    message: "This image processing request could not be found. It may have expired.",
    code: API_ERROR_REQUEST_NOT_FOUND,
  },
  unknown: {
    error: "Status check failed",
    message: "Unable to check image processing status. Please try again.",
    code: API_ERROR_INPAINT_STATUS_FAILED,
  },
} as const;

export const INPAINT_TERMINAL_ERROR_BODY = {
  status: "ERROR",
  error: "Inpainting failed",
  message: "The image editing process encountered an error. Please try again.",
  retryable: false,
  code: API_ERROR_INPAINT_TERMINAL,
} as const;

export type ClassifiedError = {
  error: string;
  message: string;
  retryable: boolean;
  code: string;
  status: number;
};

export function classifyStatusError(error: unknown): ClassifiedError {
  return classifyIntegrationError(error, INPAINT_STATUS_ERROR_COPY);
}

// (Provider-specific status types were removed when this module was
// refactored onto `@/lib/inference`. The abstraction returns the
// normalized status directly, so no fal-only types live here anymore.)

// ─── Image Persistence ────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Bound on retrying persistence after a row enters PERSISTENCE_FAILED.
 * After this many milliseconds the route stops looping the client poller
 * and returns the fal CDN URL with `persisted: false` (issue #687):
 * the editor surfaces a "this URL will expire" warning and the user
 * can move on instead of watching a spinner that never resolves. The
 * row stays in PERSISTENCE_FAILED so a future upload retry (e.g. after
 * Supabase is restored) can still complete it. Two minutes is well
 * above the poller's natural cadence (1s → 2s → 4s …) so the user
 * gets a real shot at a transient Supabase blip resolving, but short
 * enough that the eventual stuck-state recovery is fast.
 */
const PERSISTENCE_GIVE_UP_MS = 2 * 60 * 1000;

interface PersistenceResult {
  persisted: boolean;
  imageUrl: string | null;
}

/**
 * Downloads the fal result image and uploads it to Supabase storage.
 * Returns { persisted: true, imageUrl } on success, { persisted: false, imageUrl: null } on failure.
 * Issue #717: download failures are logged and correlatable.
 */
export async function persistFalImage(
  falImageUrl: string,
  requestId: string
): Promise<PersistenceResult> {
  let persisted = true;
  let resolvedImageUrl: string | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let imageBlob: Blob;
    try {
      imageBlob = await fetch(falImageUrl, { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`fal CDN returned ${r.status} ${r.statusText}`);
        return r.blob();
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const supabase = await createSupabaseRequestClient();
    const objectPath = `after-${requestId}.png`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("staging-images")
      .upload(objectPath, imageBlob, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError || !uploadData) {
      persisted = false;
      console.error(
        JSON.stringify({ event: "inpaint_upload_failed", requestId }),
        uploadError?.message ?? "upload resolved without data"
      );
    } else {
      const { data: publicUrlData } = supabase.storage
        .from("staging-images")
        .getPublicUrl(objectPath);

      if (publicUrlData?.publicUrl) {
        resolvedImageUrl = publicUrlData.publicUrl;
      } else {
        persisted = false;
        console.error(
          JSON.stringify({ event: "inpaint_public_url_missing", requestId })
        );
      }
    }
  } catch (storageError) {
    persisted = false;
    console.error(
      JSON.stringify({ event: "inpaint_persist_failed", requestId }),
      storageError
    );
  }

  return { persisted, imageUrl: resolvedImageUrl };
}

// ─── Fal Status Polling ────────────────────────────────────────────────────────

export interface InpaintStatusResult {
  /**
   * One of:
   * - `"completed"`: the job finished and the result is durable storage
   *   (or an expiring fal CDN URL with `persisted: false`, issue #687).
   * - `"ERROR"`: terminal failure (row already marked ERROR, fal returned
   *   ERROR, or the row is missing).
   * - `"IN_QUEUE" | "IN_PROGRESS"`: passthrough from
   *   `@fal-ai/client@1.x`'s `queue.status`. The client classifier maps
   *   these to `pending` and keeps polling — collapsing them to
   *   `"retryable"` made the editor render "Processing: retryable"
   *   forever while burning the full maxAttempts budget on healthy jobs.
   * - `"retryable"`: a non-fatal in-process failure (COMPLETED but the
   *   result endpoint could not produce a URL, or a PERSISTENCE_FAILED
   *   retry that still has no URL) — the poller retries briefly.
   */
  status: "completed" | "retryable" | "ERROR" | "IN_QUEUE" | "IN_PROGRESS";
  imageUrl?: string | null;
  persisted?: boolean;
}

/**
 * Returns true when the thrown error indicates the queue no longer
 * knows this requestId (HTTP 404 / "Not Found" from `queue.status` or
 * `queue.result`). Each provider's queue prunes requestIds after its
 * TTL, so an InpaintRequest row that outlives the queue entry is
 * orphaned: the work was billed but its result is no longer
 * retrievable. Detecting this shape lets the caller mark the row
 * terminal instead of looping the poller forever (#1187 follow-up).
 * The abstraction's adapters normalize provider-specific 404s into
 * `InferenceRequestGoneError`; we also accept a few legacy shapes
 * (plain `Error` with "Not Found" / "404" in the message) for the
 * case where a network/transport wrapper ate the original typed
 * error. Side effects: none (pure).
 */
function isInferenceRequestGone(error: unknown): boolean {
  if (error instanceof InferenceRequestGoneError) {
    return error.originalStatus === 404;
  }
  if (error instanceof Error) {
    const message = error.message ?? "";
    return message.includes("Not Found") || message.includes("404");
  }
  return false;
}

/**
 * Best-effort marks the InpaintRequest row as ERROR in the database
 * (so a subsequent page load does not auto-resume the orphaned job)
 * and returns the terminal response body. A failed row update is
 * logged but does not change the response — the user must see the
 * terminal state either way. Side effects: one Prisma update (best
 * effort) plus one `console.error` on failure.
 */
async function markRowTerminalAndReturnError(
  requestId: string
): Promise<InpaintStatusResult> {
  try {
    await prisma.inpaintRequest.update({
      where: { id: requestId },
      data: { status: "ERROR" },
    });
  } catch (recordError) {
    console.error(
      JSON.stringify({ event: "inpaint_lost_row_update_failed", requestId }),
      recordError
    );
  }
  return { status: "ERROR", imageUrl: null, persisted: false };
}

/**
 * Delays (ms) before each extra `client.status` retry after a 404
 * (#1202). Two short retries catch submit→status propagation delays
 * and routing blips without noticeably slowing the poller. Mutable
 * only through `_setStatusGoneRetryDelaysForTests`.
 */
let STATUS_GONE_RETRY_DELAYS_MS: readonly number[] = [250, 750];

/** Test-only: shrink the retry delays so tests don't sleep. */
export function _setStatusGoneRetryDelaysForTests(delays: readonly number[]): void {
  STATUS_GONE_RETRY_DELAYS_MS = delays;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

type GoneRecovery =
  | { kind: "status"; statusResponse: { status: string; raw?: unknown } }
  | { kind: "result"; payload: { images?: Array<{ url: string }> } | null }
  | { kind: "gone" };

/**
 * Called after `client.status` 404s (#1202). Retries `status` up to
 * `STATUS_GONE_RETRY_DELAYS_MS.length` times; if every retry still
 * 404s, asks `client.result` once. Returns:
 * - `status`: a retry succeeded, carry on with the normal flow.
 * - `result`: status stayed gone but the result endpoint still had the
 *   output, so the caller persists it on the existing row.
 * - `gone`: every check 404'd (or the result call failed outright);
 *   the caller marks the row ERROR.
 * Non-404 errors from a status retry are rethrown so the route's
 * existing error classification still applies. Side effects: up to
 * N+1 provider calls and `console.warn` breadcrumbs.
 */
async function recoverFromStatusGone(
  client: Awaited<ReturnType<typeof getInferenceClient>>,
  requestId: string
): Promise<GoneRecovery> {
  const inpaintModel = LOGICAL_MODEL.FLUX_FILL;
  for (const delay of STATUS_GONE_RETRY_DELAYS_MS) {
    await sleep(delay);
    try {
      const statusResponse = await client.status(inpaintModel, requestId);
      console.warn(
        JSON.stringify({ event: "inpaint_status_404_recovered_on_retry", requestId })
      );
      return { kind: "status", statusResponse };
    } catch (retryError) {
      if (!isInferenceRequestGone(retryError)) throw retryError;
    }
  }

  try {
    const { data } = await client.result<{ images?: Array<{ url: string }> }>(
      inpaintModel,
      requestId
    );
    console.warn(
      JSON.stringify({ event: "inpaint_status_404_recovered_via_result", requestId })
    );
    return { kind: "result", payload: data };
  } catch (resultError) {
    console.error(
      JSON.stringify({ event: "inpaint_status_and_result_gone", requestId }),
      resultError
    );
    return { kind: "gone" };
  }
}

/**
 * Fetches fal queue status and handles all status transitions:
 * - COMPLETED: fetch result, persist to Supabase, update DB
 * - ERROR: mark terminal in DB, return terminal body
 * - PERSISTENCE_FAILED: retry persistence
 * - IN_QUEUE/PROCESSING: return current status
 */
export async function pollFalStatus(requestId: string): Promise<InpaintStatusResult> {
  const inpaintRequest = await prisma.inpaintRequest.findUnique({
    where: { id: requestId },
    select: {
      status: true,
      resultUrl: true,
      updatedAt: true,
      room: { select: { project: { select: { userId: true } } } },
    },
  });

  if (!inpaintRequest) {
    return { status: "ERROR", imageUrl: null, persisted: false };
  }

  // Already-done: serve stored result without touching the provider
  const persistenceDecision = decideInpaintPersistence({
    status: inpaintRequest.status,
    resultUrl: inpaintRequest.resultUrl,
  });

  if (persistenceDecision.kind === "return-stored") {
    return { status: "completed", imageUrl: persistenceDecision.url, persisted: true };
  }

  // Terminal error: dead job, fail fast
  if (inpaintRequest.status === "ERROR") {
    return { status: "ERROR", imageUrl: null, persisted: false };
  }

  // Resolve the active inference client (fal by default; Replicate when
  // INFERENCE_PROVIDER=replicate). The client is cached at module
  // level, so this is allocation-free after the first call. The model
  // is the inpaint model — the only queue user today.
  const client = await getInferenceClient();
  const inpaintModel = LOGICAL_MODEL.FLUX_FILL;

  // PERSISTENCE_FAILED: retry persistence, with a bounded give-up so
  // the poller cannot loop forever when Supabase is the failure mode.
  if (inpaintRequest.status === "PERSISTENCE_FAILED") {
    let resultPayload: { images?: Array<{ url: string }> } | null = null;
    try {
      const { data } = await client.result<{
        images?: Array<{ url: string }>;
      }>(inpaintModel, requestId);
      resultPayload = data;
    } catch (resultError) {
      // The provider's queue prunes requestIds after their TTL. If
      // the result endpoint 404s, the InpaintRequest row is
      // orphaned: the work was billed but is unrecoverable. Mark the
      // row ERROR and return terminal so the poller stops; otherwise
      // the client polls a phantom job forever and the editor's
      // button is permanently disabled (#1187 follow-up).
      if (isInferenceRequestGone(resultError)) {
        return await markRowTerminalAndReturnError(requestId);
      }
      console.error(
        JSON.stringify({ event: "inpaint_result_fetch_failed", requestId }),
        resultError
      );
    }
    const falImageUrl: string | null =
      resultPayload?.images?.[0]?.url ?? null;
    if (!falImageUrl) {
      return { status: "retryable", imageUrl: null, persisted: false };
    }

    // Bound the retry window: after PERSISTENCE_GIVE_UP_MS the row has
    // been failing long enough that the fal CDN URL is at risk of
    // expiring. Return `completed` with `persisted: false` so the
    // poller terminates; the client (issue #687) surfaces a "this URL
    // will expire" warning rather than letting the user wait on a
    // never-resolving spinner. The row stays in PERSISTENCE_FAILED so
    // a future upload retry (e.g. after Supabase is restored) can
    // still complete it.
    if (
      Date.now() - inpaintRequest.updatedAt.getTime() >=
      PERSISTENCE_GIVE_UP_MS
    ) {
      return {
        status: "completed",
        imageUrl: falImageUrl,
        persisted: false,
      };
    }

    const { persisted, imageUrl } = await persistFalImage(falImageUrl, requestId);
    if (persisted && imageUrl) {
      await prisma.inpaintRequest.update({
        where: { id: requestId },
        data: { status: "COMPLETED", resultUrl: imageUrl },
      });
      return { status: "completed", imageUrl, persisted: true };
    }
    return { status: "retryable", imageUrl: falImageUrl, persisted: false };
  }

  // Fetch provider status. A 404 here is NOT proof the work is lost
  // (#1202): `status` and `result` are separate endpoints, and a 404
  // from `status` is often a propagation delay or routing blip while
  // the result is still retrievable (fal keeps results for at least
  // 7 days). So retry `status` a bounded number of times, then ask
  // `result` directly. Only when every check says "gone" is the row
  // marked ERROR. Worst-case cost: STATUS_GONE_RETRY_DELAYS_MS.length
  // extra `status` calls plus one `result` call.
  let statusResponse: { status: string; raw?: unknown };
  try {
    statusResponse = await client.status(inpaintModel, requestId);
  } catch (statusError) {
    if (!isInferenceRequestGone(statusError)) throw statusError;
    const recovered = await recoverFromStatusGone(client, requestId);
    if (recovered.kind === "status") {
      statusResponse = recovered.statusResponse;
    } else if (recovered.kind === "result") {
      return await finishCompletedJob(requestId, recovered.payload);
    } else {
      return await markRowTerminalAndReturnError(requestId);
    }
  }

  if (statusResponse.status === "ERROR") {
    // Best-effort: failed write must not flip terminal response back to retryable
    try {
      await prisma.inpaintRequest.update({ where: { id: requestId }, data: { status: "ERROR" } });
    } catch (recordError) {
      console.error(JSON.stringify({ event: "inpaint_error_record_failed", requestId }), recordError);
    }
    return { status: "ERROR", imageUrl: null, persisted: false };
  }

  // In-flight (IN_QUEUE / IN_PROGRESS) — pass the provider status
  // through verbatim. The client's `classifyStatusResponse` already
  // maps these to `pending` and keeps polling, so the editor shows
  // "Processing: IN_PROGRESS" instead of "Processing: retryable" and
  // the backoff loop is no longer wasted on a healthy job.
  if (statusResponse.status === "IN_QUEUE" || statusResponse.status === "IN_PROGRESS") {
    return {
      status: statusResponse.status,
      imageUrl: null,
      persisted: false,
    };
  }

  if (statusResponse.status === "COMPLETED") {
    let resultPayload: { images?: Array<{ url: string }> } | null = null;
    try {
      const { data } = await client.result<{
        images?: Array<{ url: string }>;
      }>(inpaintModel, requestId);
      resultPayload = data;
    } catch (resultError) {
      console.error(
        JSON.stringify({ event: "inpaint_result_fetch_failed", requestId }),
        resultError
      );
      // A 404 here also means the queue pruned the requestId after
      // the COMPLETED status came back (rare race). Treat the same
      // as a status-phase 404: mark the row ERROR and return
      // terminal.
      if (isInferenceRequestGone(resultError)) {
        return await markRowTerminalAndReturnError(requestId);
      }
      return { status: "retryable", imageUrl: null, persisted: false };
    }
    return await finishCompletedJob(requestId, resultPayload);
  }

  return { status: "retryable", imageUrl: null, persisted: false };
}

/**
 * Persists a completed job's result and records the row transition.
 * Shared by the normal COMPLETED path and the #1202 404-recovery path,
 * so a recovered job reuses the existing row's lifecycle (no second
 * billed InpaintRequest). Side effects: one image download + Supabase
 * upload (via `persistFalImage`) and one best-effort Prisma update.
 */
async function finishCompletedJob(
  requestId: string,
  resultPayload: { images?: Array<{ url: string }> } | null
): Promise<InpaintStatusResult> {
  const falImageUrl = resultPayload?.images?.[0]?.url;

  if (!falImageUrl) {
    return { status: "retryable", imageUrl: null, persisted: false };
  }

  const { persisted, imageUrl } = await persistFalImage(falImageUrl, requestId);

  if (persisted && imageUrl) {
    try {
      await prisma.inpaintRequest.update({
        where: { id: requestId },
        data: { status: "COMPLETED", resultUrl: imageUrl },
      });
    } catch (recordError) {
      console.error(JSON.stringify({ event: "inpaint_record_failed", requestId }), recordError);
    }
    return { status: "completed", imageUrl, persisted: true };
  }

  // Persistence failed but the provider's image URL is available.
  // The user's job is done — hand it over with `persisted: false`
  // so the client poller terminates and the editor surfaces the
  // expiring-URL warning (issue #687). Returning `retryable` here
  // strands the poller on a phantom retry: Supabase may be down
  // (the most common cause), and looping on it produces
  // "Processing: retryable" indefinitely.
  await prisma.inpaintRequest.update({
    where: { id: requestId },
    data: { status: "PERSISTENCE_FAILED", resultUrl: null },
  }).catch((recordError) => {
    console.error(
      JSON.stringify({ event: "inpaint_persistence_failed_record_update_failed", requestId }),
      recordError
    );
  });
  return {
    status: "completed",
    imageUrl: falImageUrl,
    persisted: false,
  };
}

// ─── Request Ownership Validation ─────────────────────────────────────────────

export interface InpaintRequestIdentity {
  requestId: string;
  userId: string;
}

/**
 * Validates that an inpaint request exists and belongs to the user (via room/project).
 * Returns the request identity if valid, null if not found or not owned.
 */
export async function validateInpaintRequestOwnership(
  requestId: string,
  userId: string
): Promise<InpaintRequestIdentity | null> {
  const inpaintRequest = await prisma.inpaintRequest.findUnique({
    where: { id: requestId },
    select: {
      room: { select: { project: { select: { userId: true } } } },
    },
  });

  if (!inpaintRequest || inpaintRequest.room.project.userId !== userId) {
    return null;
  }

  return { requestId, userId };
}
