/**
 * Webhook delivery for inpainting completions (issue #1221).
 *
 * The polling path (`/api/inpaint/[requestId]/status`) is
 * client-driven: the browser asks the server, the server asks the
 * provider. This module is the server-side complement: a provider
 * completion callback lands on `/api/inpaint/webhook`, the handler
 * matches the row by `providerJobId`, and writes the result through
 * the SAME persistence contract the poller uses
 * (`persistFalImage` -> durable `COMPLETED`+resultUrl write, or
 * `PERSISTENCE_FAILED` when the upload fails).
 *
 * Idempotency: fal retries on non-2xx. The row's `status` is the dedup
 * key — a delivery for an already-COMPLETED (or ERROR) row is a 200
 * no-op, so a retry never re-bills, re-uploads, or duplicates state.
 * A delivery whose durable write did NOT land returns 503 so the
 * provider retries; the retry re-runs the persistence path, whose
 * storage upsert (same object path) is itself idempotent.
 *
 * Not done here: InpaintVersion creation stays with the existing
 * client-side action on resume, exactly as the polling path does.
 */

import { prisma } from "@/lib/prisma";
import { firstInpaintImageUrl } from "@/lib/inpaint-output";
import { logInpaintTransition, persistFalImage } from "@/lib/inpaint-status";

export type InpaintWebhookOutcome =
  | { kind: "completed"; imageUrl: string }
  | { kind: "noop" } // row already COMPLETED or ERROR: dedup
  | { kind: "not_found" }
  | { kind: "provider_error" } // delivery reported job failure
  | { kind: "persistence_failed"; providerImageUrl: string }
  | { kind: "write_failed"; imageUrl: string }
  | { kind: "result_fetch_failed" } // response_url unfetchable: 503, provider retries
  | { kind: "in_progress" } // mid-flight fal status: accepted no-op
  | { kind: "unrecognized" };

/**
 * Applies one verified webhook delivery. The route has already
 * verified the signature and parsed the payload; this function owns
 * the row lookup and the state machine. Never throws for
 * provider-controlled input: every failure is a typed outcome the
 * route maps to an HTTP status.
 */
export async function applyInpaintWebhookEvent(params: {
  providerJobId: string;
  status: string;
  output: unknown;
  /** fal's queue.status.updated carries the result here, not inline. */
  responseUrl?: string | null;
}): Promise<InpaintWebhookOutcome> {
  const { providerJobId, status, output, responseUrl } = params;

  const row = await prisma.inpaintRequest.findUnique({
    where: { providerJobId },
    select: { id: true, status: true, resultUrl: true },
  });
  if (!row) {
    return { kind: "not_found" };
  }

  // Dedup: anything terminal stays terminal. Re-running the
  // persistence path for a COMPLETED row would re-upload (the storage
  // upsert is idempotent, but the DB write is pointless) and a second
  // "done" event for an ERROR row would resurrect it.
  if (row.status === "COMPLETED" || row.status === "ERROR") {
    return { kind: "noop" };
  }

  const providerImageUrl = firstInpaintImageUrl(output);
  if (providerImageUrl) {
    return persistCompletion(row.id, providerJobId, providerImageUrl);
  }

  // No image inline. fal's queue.status.updated never carries the
  // result; a completed fal delivery points at `response_url`, so
  // fetch it (a completed status with neither is what fal's "OK"
  // looks like). Mid-flight statuses are an accepted no-op: the
  // poller still governs progress, and a 4xx here would only teach
  // the provider to stop updating us.
  const completionStatuses = new Set(["OK", "COMPLETED", "SUCCESS"]);
  const inFlightStatuses = new Set(["IN_QUEUE", "IN_PROGRESS", "PROCESSING", "STARTING"]);
  if (completionStatuses.has(status) && responseUrl) {
    try {
      const res = await fetch(responseUrl);
      if (res.ok) {
        const fetched = (await res.json()) as unknown;
        const fetchedUrl = firstInpaintImageUrl(fetched);
        if (fetchedUrl) {
          const persisted = await persistCompletion(row.id, providerJobId, fetchedUrl);
          return persisted;
        }
        return { kind: "unrecognized" };
      }
      console.error(
        JSON.stringify({
          event: "inpaint_webhook_result_fetch_failed",
          requestId: row.id,
          responseStatus: res.status,
        })
      );
      return { kind: "result_fetch_failed" };
    } catch (fetchError) {
      console.error(
        JSON.stringify({
          event: "inpaint_webhook_result_fetch_failed",
          requestId: row.id,
        }),
        fetchError
      );
      return { kind: "result_fetch_failed" };
    }
  }
  if (inFlightStatuses.has(status)) {
    return { kind: "in_progress" };
  }

  // No image in the payload: the only other meaningful delivery is a
  // job-failure notice. fal sends { error: ... }-shaped failures;
  // anything else we do not understand is a 4xx, not a silent OK.
  const jobFailed =
    status === "ERROR" ||
    status === "FAILED" ||
    (output !== null &&
      typeof output === "object" &&
      "error" in (output as Record<string, unknown>));
  if (jobFailed) {
    await prisma.inpaintRequest
      .update({
        where: { id: row.id },
        data: { status: "ERROR" },
      })
      .catch((recordError) => {
        console.error(
          JSON.stringify({
            event: "inpaint_webhook_error_status_failed",
            requestId: row.id,
            providerJobId,
          }),
          recordError
        );
      });
    // Issue #1116: the ERROR flip is a pipeline state transition.
    await logInpaintTransition(row.id, "failed");
    return { kind: "provider_error" };
  }

  return { kind: "unrecognized" };
}

/**
 * Resolves the delivery mode from `INFERENCE_DELIVERY`. Unset/empty
 * (and any unknown value) is `polling`, which keeps today's behavior
 * byte-identical for every deploy that has not opted in.
 */
export function resolveInpaintDelivery(): "polling" | "webhook" {
  const raw = process.env.INFERENCE_DELIVERY?.trim().toLowerCase();
  return raw === "webhook" ? "webhook" : "polling";
}

/**
 * Shared completion tail for inline and response_url-fetched results:
 * persist the image, then the durable COMPLETED write, with the same
 * failure contract in both paths.
 */
async function persistCompletion(
  requestId: string,
  providerJobId: string,
  providerImageUrl: string
): Promise<InpaintWebhookOutcome> {
  const { persisted, imageUrl } = await persistFalImage(
    providerImageUrl,
    requestId
  );

  if (persisted && imageUrl) {
    try {
      await prisma.inpaintRequest.update({
        where: { id: requestId },
        data: { status: "COMPLETED", resultUrl: imageUrl },
      });
      // Issue #1116: the COMPLETED flip is a pipeline state transition.
      await logInpaintTransition(requestId, "completed");
      return { kind: "completed", imageUrl };
    } catch (recordError) {
      // Same contract as finishCompletedJob (issue #1136): a failed
      // durable write is reported, never papered over as completed.
      // 503 makes the provider retry; the retry re-runs this path.
      console.error(
        JSON.stringify({
          event: "inpaint_webhook_record_failed",
          requestId,
          providerJobId,
        }),
        recordError
      );
      return { kind: "write_failed", imageUrl };
    }
  }

  // Upload failed (most commonly Supabase down). Mark the row so
  // the polling path's PERSISTENCE_FAILED retry/give-up logic still
  // governs it, and 503 so the provider retries the delivery.
  await prisma.inpaintRequest
    .update({
      where: { id: requestId },
      data: {
        status: "PERSISTENCE_FAILED",
        resultUrl: null,
        falResultUrl: imageUrl,
        persistenceAttempts: { increment: 1 },
        lastPersistenceAttemptAt: new Date(),
      },
    })
    .catch((recordError) => {
      console.error(
        JSON.stringify({
          event: "inpaint_webhook_persist_status_failed",
          requestId,
          providerJobId,
        }),
        recordError
      );
    });
  return { kind: "persistence_failed", providerImageUrl };
}
