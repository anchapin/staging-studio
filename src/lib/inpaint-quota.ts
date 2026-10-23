/**
 * Issue #1421 — central release of the `inpaint` daily-quota reservation.
 *
 * The `DAILY_INPAINT_LIMIT` unit is claimed up front (issue #1111's
 * atomic `claimDailyQuota`) so a concurrent burst cannot overshoot the
 * cap. Every path that ends with NO durable result for the user must
 * give that unit back, otherwise a failed job burns the user's daily
 * cap for the whole day. Before this module the refund lived inline in
 * the route's outer catch only, so three separate paths kept the
 * charge:
 *
 *   1. provider-side submit failure (the route's background tick) —
 *      the row was flipped to ERROR but the unit was kept;
 *   2. the poller flipping a row to a terminal failure state
 *      (`markRowTerminalAndReturnError` / `provider_reported_error` /
 *      `PERSISTENCE_FAILED`) — the row died, the quota did not;
 *   3. the post-submit `providerJobId` write failing — the provider
 *      billed us for a job no DB row can map to.
 *
 * Every one of those paths now calls
 * {@link releaseInpaintQuotaReservation} — the SINGLE helper that owns
 * the refund — so the paths cannot diverge again. The helper is
 * idempotent per row: it refuses to refund a row whose previous status
 * already means "the unit was released" (ERROR / PERSISTENCE_FAILED /
 * COMPLETED), so a row that dies twice (PERSISTENCE_FAILED → ERROR)
 * cannot hand the user two units back and eat a unit another request
 * legitimately claimed.
 *
 * The refund is the *firm-internal* daily-quota counter only; the
 * upstream provider (Alibaba DashScope, ~$0.04/image) has already
 * billed us or not independently of this counter. When the provider
 * cost could not be avoided (path 3 with a failed provider cancel) the
 * helper records a known-cost write-off event so the spend is visible
 * instead of silently absorbed.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { refundInpaintQuota } from "@/lib/inpaint-submit";
import { getInferenceClient, LOGICAL_MODEL } from "@/lib/inference";

// ─── Central release helper ───────────────────────────────────────────────

/**
 * Why a reservation is being released. Kept as a closed union so the
 * log line is greppable and the reason is always one of the audited
 * failure paths.
 */
export type InpaintQuotaReleaseReason =
  /** The provider rejected / failed the submit (no job exists upstream). */
  | "provider_submit_failed"
  /** The provider accepted the job but the post-submit row write failed. */
  | "post_submit_record_write_failed"
  /** The provider job is no longer reachable (poller gone-recovery). */
  | "provider_job_unreachable"
  /** The provider reported the job as failed. */
  | "provider_reported_error"
  /** The provider produced a result but no durable row/URL was stored. */
  | "persistence_failed";

export interface InpaintQuotaReleaseParams {
  /** Owner of the reservation (the user the unit was claimed for). */
  userId: string;
  /** InpaintRequest id the reservation was claimed for. */
  requestId: string;
  /** Which audited failure path is releasing the unit. */
  reason: InpaintQuotaReleaseReason;
  /**
   * The row's status BEFORE the terminal transition. `null`/undefined
   * means "unknown" and is treated as "not yet released".
   */
  previousStatus?: string | null;
  /** Provider job id, when known (for the write-off record). */
  providerJobId?: string | null;
  /**
   * True when the provider may already have billed us for work the
   * user will never receive.
   */
  providerCostIncurred?: boolean;
  /**
   * Result of the provider-side cancel attempt (issue #1421 path 3).
   * `null` means no cancel was attempted (the provider never accepted
   * the job). `false` means the cancel was attempted and failed — the
   * provider cost is then a known-cost write-off.
   */
  providerCancelSucceeded?: boolean | null;
}

export interface InpaintQuotaReleaseResult {
  /** True when a unit was actually given back to the user. */
  refunded: boolean;
  /** True when the release was skipped because the unit was already free. */
  skipped: boolean;
  reason: InpaintQuotaReleaseReason;
}

/**
 * Row statuses that mean "the reservation for this row was already
 * released". A row that is already in one of these states must not
 * trigger a second refund.
 */
const QUOTA_RELEASED_STATUSES = new Set(["ERROR", "PERSISTENCE_FAILED", "COMPLETED"]);

/**
 * THE single place an inpaint quota reservation is released.
 *
 * Every terminal-failure path (route background tick, poller terminal
 * transitions) MUST go through this helper so the paths cannot drift
 * apart again. The refund itself never throws (`refundDailyQuota` is
 * best-effort and clamps at zero), so this is safe to call from a
 * failure path.
 */
export async function releaseInpaintQuotaReservation(
  params: InpaintQuotaReleaseParams
): Promise<InpaintQuotaReleaseResult> {
  const previousStatus = params.previousStatus ?? null;

  if (previousStatus && QUOTA_RELEASED_STATUSES.has(previousStatus)) {
    console.warn(
      JSON.stringify({
        event: "inpaint_quota_release_skipped",
        requestId: params.requestId,
        userId: params.userId,
        reason: params.reason,
        previousStatus,
        skippedBecause: "already_released",
      })
    );
    return { refunded: false, skipped: true, reason: params.reason };
  }

  await refundInpaintQuota(params.userId);

  // The upstream provider cost is NOT covered by this counter. When the
  // provider accepted the job but we could not cancel it, the firm is
  // out the per-image cost — record it as a known-cost write-off rather
  // than letting it disappear into the counter.
  const providerCostWriteOff =
    Boolean(params.providerCostIncurred) && params.providerCancelSucceeded !== true;

  console.error(
    JSON.stringify({
      event: "inpaint_quota_reservation_released",
      requestId: params.requestId,
      userId: params.userId,
      reason: params.reason,
      previousStatus,
      providerJobId: params.providerJobId ?? null,
      providerCancelSucceeded: params.providerCancelSucceeded ?? null,
      providerCostWriteOff,
    })
  );

  return { refunded: true, skipped: false, reason: params.reason };
}

// ─── Post-submit DB write (issue #1421 path 3) ────────────────────────────

/**
 * Attempts on the post-submit `providerJobId` write. The write is a
 * single UPDATE; a transient DB blip must not orphan a job the
 * provider already accepted (and billed).
 */
export const INPAINT_PROVIDER_JOB_WRITE_ATTEMPTS = 3;
export const INPAINT_PROVIDER_JOB_WRITE_RETRY_DELAY_MS = 200;

/**
 * Prisma error codes that mean "the database blipped, try again":
 * - `P2034` — transaction failed due to a write conflict / deadlock;
 * - `P2028` — transaction API error (timeout / already closed);
 * - `P1001`/`P1002`/`P1017` — the server was unreachable / shut down.
 */
const TRANSIENT_PRISMA_CODES = new Set([
  "P2034",
  "P2028",
  "P1001",
  "P1002",
  "P1017",
]);

/** Socket-level error codes that mean "the connection dropped". */
const TRANSIENT_SOCKET_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN",
]);

/**
 * Classifies a failed row write as transient (retryable) or permanent.
 * Pure so the classification can be unit-tested without a database.
 */
export function isTransientDbWriteError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return TRANSIENT_PRISMA_CODES.has(error.code);
  }

  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    if (TRANSIENT_PRISMA_CODES.has(code)) return true;
    if (TRANSIENT_SOCKET_CODES.has(code)) return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return /econnreset|etimedout|econnrefused|epipe|eai_again|socket hang up|connection reset|connection terminated|connection closed|timed? ?out|timeout|deadlock|serialization failure|write conflict/i.test(
    message
  );
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Writes the provider's job id (and the synchronous result URL, when
 * the provider returned one) onto the InpaintRequest row, retrying
 * TRANSIENT failures (issue #1421 path 3).
 *
 * Before this helper the write was a single unguarded UPDATE inside the
 * route's background tick: a transient DB blip left the row in its
 * prior state while Alibaba had already accepted (and billed) the job,
 * so the result could never be fetched or surfaced — an invisible
 * billed job with no trace in the app.
 *
 * Throws the last error when every attempt fails, so the caller can
 * run the provider-cancel + refund path.
 */
export async function writeInpaintProviderJobIdWithRetry(params: {
  requestId: string;
  providerJobId: string;
  /** Durable result URL for synchronous providers (Alibaba). */
  resultUrl?: string | null;
}): Promise<void> {
  for (let attempt = 1; attempt <= INPAINT_PROVIDER_JOB_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await prisma.inpaintRequest.update({
        where: { id: params.requestId },
        data: {
          providerJobId: params.providerJobId,
          // #1240 multi-instance fix: synchronous providers (Alibaba)
          // surface the durable DashScope-hosted URL inline; async
          // providers fall back to IN_PROGRESS.
          ...(params.resultUrl
            ? { status: "COMPLETED", resultUrl: params.resultUrl }
            : { status: "IN_PROGRESS" }),
        },
      });
      return;
    } catch (error) {
      if (attempt === INPAINT_PROVIDER_JOB_WRITE_ATTEMPTS) {
        throw error;
      }
      if (!isTransientDbWriteError(error)) {
        throw error;
      }
      console.error(
        JSON.stringify({
          event: "inpaint_provider_job_write_retry",
          requestId: params.requestId,
          providerJobId: params.providerJobId,
          attempt,
          attempts: INPAINT_PROVIDER_JOB_WRITE_ATTEMPTS,
        }),
        error
      );
      await sleep(INPAINT_PROVIDER_JOB_WRITE_RETRY_DELAY_MS * attempt);
    }
  }
  throw new Error("Unexpected: writeInpaintProviderJobIdWithRetry exhausted all attempts");
}

// ─── Provider cancel (issue #1421 path 3) ─────────────────────────────────

export interface InpaintProviderCancelOutcome {
  /** True when a cancel call was made (or a cancel method was looked up). */
  attempted: boolean;
  /** True when the provider confirmed the job was cancelled. */
  cancelled: boolean;
  /** Machine-readable explanation (logged; also drives the write-off). */
  reason: string;
}

/**
 * Attempts to cancel a provider job that the DB cannot map to a row.
 *
 * Issue #1421 path 3: the provider accepted the job and billed us, but
 * the row write failed, so the result would be invisible. Cancelling the
 * upstream job is the only way to stop the money.
 *
 * The `InferenceClient` interface gained an OPTIONAL `cancel` method
 * (issue #1421) so a provider without a cancel API (today's Alibaba
 * DashScope adapter uses the SYNCHRONOUS multimodal-generation
 * endpoint, which has no task id and no cancel endpoint) simply reports
 * `cancelled: false` instead of throwing. The caller then records the
 * provider cost as a known-cost write-off.
 */
export async function cancelInpaintProviderJob(
  providerJobId: string
): Promise<InpaintProviderCancelOutcome> {
  try {
    const client = await getInferenceClient();
    if (typeof client.cancel !== "function") {
      return {
        attempted: true,
        cancelled: false,
        reason: "provider_client_has_no_cancel_method",
      };
    }
    const outcome = await client.cancel(LOGICAL_MODEL.FLUX_FILL, providerJobId);
    return {
      attempted: true,
      cancelled: Boolean(outcome?.cancelled),
      reason: outcome?.reason ?? "provider_cancel_returned_no_reason",
    };
  } catch (error) {
    return {
      attempted: true,
      cancelled: false,
      reason: `provider_cancel_failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
