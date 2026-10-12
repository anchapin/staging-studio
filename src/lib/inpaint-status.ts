import { prisma } from "@/lib/prisma";
import { checkAndRecordRateLimit } from "@/lib/sliding-window-ratelimit";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { decideInpaintPersistence } from "@/lib/inpaint-persistence";
import { classifyIntegrationError } from "@/lib/error-classify";
import {
  getInferenceClient,
  InferenceRequestGoneError,
  LOGICAL_MODEL,
} from "@/lib/inference";
import { firstInpaintImageUrl, type RawInpaintOutput } from "@/lib/inpaint-output";
import {
  logInpaintEvent,
  type InpaintEventStatus,
} from "@/lib/logInpaintEvent";
import {
  API_ERROR_INPAINT_STATUS_FAILED,
  API_ERROR_INPAINT_TERMINAL,
  API_ERROR_REQUEST_NOT_FOUND,
} from "@/lib/api-errors";

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export const INPAINT_STATUS_RATE_LIMIT = 10;
export const INPAINT_STATUS_RATE_WINDOW_MS = 60_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Sliding-window rate limiter for inpaint status polling (10/min per user and
 * request), backed by Postgres so the cap holds across serverless instances.
 * Issue #1123: the previous module-level Map was per-lambda state — it never
 * saw other instances' requests (cap effectively 10 × N instances) and its
 * entries were never evicted (unbounded memory). The Postgres limiter stores
 * the window in DailyApiUsage.timestamps under a per-(user, request) row key
 * and prunes expired entries on every write.
 */
export async function checkInpaintStatusRateLimit(
  userId: string,
  requestId: string
): Promise<RateLimitResult> {
  const result = await checkAndRecordRateLimit(
    `inpaint-status:${userId}:${requestId}`,
    INPAINT_STATUS_RATE_LIMIT,
    INPAINT_STATUS_RATE_WINDOW_MS
  );

  if (!result.allowed) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((result.resetAt - Date.now()) / 1000)
      ),
    };
  }

  return {
    allowed: true,
    remaining: result.remaining,
    retryAfterSeconds: 0,
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

/**
 * Issue #1143: hard cap on provider-touching persistence attempts (the
 * initial try plus retries) for a PERSISTENCE_FAILED row. Before the cap,
 * every poll inside the give-up window re-downloaded the result and
 * re-uploaded it byte-identical, uncapped. After the cap the branch
 * returns the #687 terminal handover (`completed` / `persisted: false`)
 * without touching the provider; the row STAYS PERSISTENCE_FAILED so a
 * later Supabase recovery can still complete it.
 */
export const MAX_PERSISTENCE_ATTEMPTS = 5;

/**
 * Issue #1143: exponential backoff before the next persistence attempt,
 * in ms, keyed on the attempts already made. Pure so tests can pin it;
 * the cap at 30s keeps a resumed row responsive while still collapsing
 * a 60-poll burst into 5 tries (1s, 2s, 4s, 8s, then the cap).
 */
export function persistenceBackoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(attempts - 1, 0), 30_000);
}

interface PersistenceResult {
  persisted: boolean;
  imageUrl: string | null;
}

/**
 * Downloads the provider result image (fal or Replicate CDN URL) and uploads it to Supabase storage.
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
  // Issue #1116: the ERROR flip is a pipeline state transition; log it.
  await logInpaintTransition(requestId, "failed");
  return { status: "ERROR", imageUrl: null, persisted: false };
}

/**
 * Issue #1116: logs one pipeline state-transition event with the row's
 * identity (userId via room.project, roomId, variantSlot). Best-effort:
 * the identity read never throws into the pipeline path, and a row
 * deleted mid-flight logs nothing.
 */
export async function logInpaintTransition(
  requestId: string,
  status: InpaintEventStatus
): Promise<void> {
  try {
    const row = await prisma.inpaintRequest.findUnique({
      where: { id: requestId },
      select: {
        roomId: true,
        variantSlot: true,
        room: { select: { project: { select: { userId: true } } } },
      },
    });
    if (!row) return;
    logInpaintEvent({
      userId: row.room.project.userId,
      requestId,
      roomId: row.roomId,
      variantSlot: row.variantSlot,
      status,
    });
  } catch {
    // Observability never derails the pipeline.
  }
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
  | { kind: "result"; payload: RawInpaintOutput }
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
    const { data } = await client.result<RawInpaintOutput>(inpaintModel, requestId);
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
      falResultUrl: true,
      persistenceAttempts: true,
      lastPersistenceAttemptAt: true,
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
  // the poller cannot loop forever when Supabase is the failure mode,
  // and (issue #1143) with memoized economics so each retry does not
  // re-download and re-upload the byte-identical result.
  if (inpaintRequest.status === "PERSISTENCE_FAILED") {
    // Issue #1143: attempt cap FIRST (review finding 1): it reads only
    // row fields and makes no provider call, so a capped row terminates
    // the moment it is noticed instead of idling out the backoff. Once
    // MAX_PERSISTENCE_ATTEMPTS tries have failed, stop touching the
    // provider entirely and hand over via the #687 terminal shape
    // (`completed` / `persisted: false`). The row STAYS
    // PERSISTENCE_FAILED: #687's manual-recovery intent (Supabase
    // restored -> the job can still complete) is preserved; terminal
    // here means "no more provider traffic", not ERROR.
    const attempts = inpaintRequest.persistenceAttempts;
    if (attempts >= MAX_PERSISTENCE_ATTEMPTS && inpaintRequest.falResultUrl) {
      return {
        status: "completed",
        imageUrl: inpaintRequest.falResultUrl,
        persisted: false,
      };
    }
    // A capped row with no memoized URL (memo writes also failing) falls
    // through: it memoizes once below and the #687 give-up window stays
    // the final bound, so no path loops unbounded.

    // Issue #1143: backoff gate. A row that just attempted persistence
    // waits before the provider is touched again; the gate reads only
    // row fields, so a poll inside the window costs no provider calls.
    const lastAttemptAt = inpaintRequest.lastPersistenceAttemptAt?.getTime() ?? null;
    if (lastAttemptAt !== null && Date.now() - lastAttemptAt < persistenceBackoffMs(attempts)) {
      return { status: "retryable", imageUrl: null, persisted: false };
    }

    // Issue #1143: memoized result URL. Use the stored provider URL
    // when present; only a legacy row (written before this column)
    // pays the `client.result` fetch. A freshly fetched URL is written
    // back best-effort before persisting so later polls skip the
    // fetch entirely.
    let falImageUrl = inpaintRequest.falResultUrl;
    if (!falImageUrl) {
      let resultPayload: RawInpaintOutput = null;
      try {
        const { data } = await client.result<RawInpaintOutput>(inpaintModel, requestId);
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
      falImageUrl = firstInpaintImageUrl(resultPayload);
      if (!falImageUrl) {
        return { status: "retryable", imageUrl: null, persisted: false };
      }
      await prisma.inpaintRequest
        .update({ where: { id: requestId }, data: { falResultUrl: falImageUrl } })
        .catch((memoError) => {
          console.error(
            JSON.stringify({ event: "inpaint_fal_result_memo_failed", requestId }),
            memoError
          );
        });
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

    // Issue #1143: record the attempt (best-effort) BEFORE the upload
    // try, so a crash mid-upload still counts and the cap eventually
    // bites.
    await prisma.inpaintRequest
      .update({
        where: { id: requestId },
        data: {
          persistenceAttempts: { increment: 1 },
          lastPersistenceAttemptAt: new Date(),
        },
      })
      .catch((attemptError) => {
        console.error(
          JSON.stringify({ event: "inpaint_persistence_attempt_record_failed", requestId }),
          attemptError
        );
      });

    const { persisted, imageUrl } = await persistFalImage(falImageUrl, requestId);
    if (persisted && imageUrl) {
      // Issue #1136 (review): same record-write contract as
      // finishCompletedJob — a failed write surfaces as `retryable`,
      // never as a completed result. Unguarded, this throw bypassed
      // the give-up window and hit the route as an unclassified 500.
      try {
        await prisma.inpaintRequest.update({
          where: { id: requestId },
          data: { status: "COMPLETED", resultUrl: imageUrl },
        });
        // Issue #1116: the COMPLETED flip is a pipeline state transition.
        await logInpaintTransition(requestId, "completed");
        return { status: "completed", imageUrl, persisted: true };
      } catch (recordError) {
        console.error(JSON.stringify({ event: "inpaint_record_failed", requestId }), recordError);
        return { status: "retryable", imageUrl: null, persisted: false };
      }
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
    let resultPayload: RawInpaintOutput = null;
    try {
      const { data } = await client.result<RawInpaintOutput>(inpaintModel, requestId);
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
 * upload (via `persistFalImage`) and one Prisma update whose failure
 * surfaces as `retryable` (issue #1136), never as a completed result.
 */
async function finishCompletedJob(
  requestId: string,
  resultPayload: RawInpaintOutput
): Promise<InpaintStatusResult> {
  // Provider-neutral: fal's { images: [{ url }] } and Replicate's
  // url / [url1, url2] both reduce to the first URL (#1199).
  const falImageUrl = firstInpaintImageUrl(resultPayload);

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
      // Issue #1116: the COMPLETED flip is a pipeline state transition.
      await logInpaintTransition(requestId, "completed");
      return { status: "completed", imageUrl, persisted: true };
    } catch (recordError) {
      // Issue #1136: the durable upload succeeded but the record write
      // did not land. Reporting `completed` here desyncs the client
      // (it writes the result into the room and saves an InpaintVersion
      // for a row the DB does not show as COMPLETED). Return
      // `retryable` so the client keeps polling; the next poll re-runs
      // the fal fetch + upsert re-upload and retries the write, and
      // once it lands the row flips to COMPLETED.
      console.error(JSON.stringify({ event: "inpaint_record_failed", requestId }), recordError);
      return { status: "retryable", imageUrl: null, persisted: false };
    }
  }

  // Persistence failed but the provider's image URL is available.
  // The user's job is done — hand it over with `persisted: false`
  // so the client poller terminates and the editor surfaces the
  // expiring-URL warning (issue #687). Returning `retryable` here
  // strands the poller on a phantom retry: Supabase may be down
  // (the most common cause), and looping on it produces
  // "Processing: retryable" indefinitely.
  // Issue #1143: memoize the provider URL on the way down so the
  // PERSISTENCE_FAILED retry path never re-fetches `client.result`,
  // and seed the attempt bookkeeping (attempt 1 is this upload).
  await prisma.inpaintRequest.update({
    where: { id: requestId },
    data: {
      status: "PERSISTENCE_FAILED",
      resultUrl: null,
      falResultUrl: falImageUrl,
      persistenceAttempts: { increment: 1 },
      lastPersistenceAttemptAt: new Date(),
    },
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
