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
import { persistFalImage } from "@/lib/inpaint-status";

export type InpaintWebhookOutcome =
  | { kind: "completed"; imageUrl: string }
  | { kind: "noop" } // row already COMPLETED or ERROR: dedup
  | { kind: "not_found" }
  | { kind: "provider_error" } // delivery reported job failure
  | { kind: "persistence_failed"; providerImageUrl: string }
  | { kind: "write_failed"; imageUrl: string }
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
}): Promise<InpaintWebhookOutcome> {
  const { providerJobId, status, output } = params;

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
    const { persisted, imageUrl } = await persistFalImage(
      providerImageUrl,
      row.id
    );

    if (persisted && imageUrl) {
      try {
        await prisma.inpaintRequest.update({
          where: { id: row.id },
          data: { status: "COMPLETED", resultUrl: imageUrl },
        });
        return { kind: "completed", imageUrl };
      } catch (recordError) {
        // Same contract as finishCompletedJob (issue #1136): a failed
        // durable write is reported, never papered over as completed.
        // 503 makes the provider retry; the retry re-runs this path.
        console.error(
          JSON.stringify({
            event: "inpaint_webhook_record_failed",
            requestId: row.id,
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
        where: { id: row.id },
        data: { status: "PERSISTENCE_FAILED", resultUrl: null },
      })
      .catch((recordError) => {
        console.error(
          JSON.stringify({
            event: "inpaint_webhook_persist_status_failed",
            requestId: row.id,
            providerJobId,
          }),
          recordError
        );
      });
    return { kind: "persistence_failed", providerImageUrl };
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
