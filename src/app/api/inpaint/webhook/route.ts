/**
 * Inpainting completion webhook (issue #1221).
 *
 * Opt-in delivery path: when `INFERENCE_DELIVERY=webhook`, the
 * provider callbacks here instead of waiting for the client poller.
 * Signature verification happens on the RAW body (not the parsed
 * JSON), so tampering with the payload cannot survive the HMAC check;
 * every rejection writes nothing.
 */

import { NextRequest, NextResponse } from "next/server";

import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from "@/lib/webhook-signature";
import { applyInpaintWebhookEvent } from "@/lib/inpaint-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InpaintWebhookBody {
  type?: string;
  status?: string;
  request_id?: string;
  id?: string;
  payload?: {
    request_id?: string;
    id?: string;
    status?: string;
    output?: unknown;
    error?: unknown;
  };
  output?: unknown;
  error?: unknown;
}

/**
 * Extracts the provider job id and terminal state from a delivery.
 * fal posts `{ type: "queue.status.updated", status, request_id,
 * output }`; the shared envelope shape also admits Replicate's
 * `{ id, status, output }`. Anything we cannot read is a 400 (the
 * provider does not retry 4xx, which is correct: we could never
 * parse a retry either) and, above all, writes nothing.
 */
export function parseInpaintWebhookBody(body: InpaintWebhookBody): {
  providerJobId: string;
  status: string;
  output: unknown;
} | null {
  const payload = body.payload ?? body;
  const providerJobId =
    payload.request_id ?? payload.id ?? body.request_id ?? body.id;
  if (typeof providerJobId !== "string" || providerJobId.length === 0) {
    return null;
  }
  const status =
    payload.status ?? body.status ?? (typeof body.type === "string" ? body.type : "");
  return {
    providerJobId,
    status: typeof status === "string" ? status : "",
    output: payload.output ?? body.output ?? null,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.INPAINT_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      JSON.stringify({ event: "inpaint_webhook_no_secret" })
    );
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 503 }
    );
  }

  const rawBody = await request.text();
  const signature =
    request.headers.get(WEBHOOK_SIGNATURE_HEADER) ?? "";

  const verification = await verifyWebhookSignature(signature, rawBody, secret);
  if (!verification.ok) {
    // 401, nothing written: an attacker with a guessed providerJobId
    // still cannot flip a row.
    console.warn(
      JSON.stringify({
        event: "inpaint_webhook_signature_rejected",
        reason: verification.reason,
      })
    );
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  let body: InpaintWebhookBody;
  try {
    body = JSON.parse(rawBody) as InpaintWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseInpaintWebhookBody(body);
  if (!parsed) {
    return NextResponse.json(
      { error: "Unrecognized payload" },
      { status: 400 }
    );
  }

  try {
    const outcome = await applyInpaintWebhookEvent(parsed);
    switch (outcome.kind) {
      case "completed":
        return NextResponse.json({ ok: true, kind: "completed" });
      case "noop":
        // Idempotent redelivery of an already-terminal row.
        return NextResponse.json({ ok: true, kind: "noop" });
      case "not_found":
        // Unknown job id: the row may have been deleted mid-flight.
        // 200, because a retry would 404 identically.
        return NextResponse.json({ ok: false, kind: "not_found" });
      case "provider_error":
        return NextResponse.json({ ok: true, kind: "provider_error" });
      case "persistence_failed":
      case "write_failed":
        // 503: the durable write did not land, so ask the provider
        // to redeliver; the retry re-runs the idempotent path.
        return NextResponse.json(
          { error: "Durable write failed", kind: outcome.kind },
          { status: 503 }
        );
      case "unrecognized":
        return NextResponse.json(
          { error: "Unrecognized payload", kind: "unrecognized" },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error(
      JSON.stringify({ event: "inpaint_webhook_handler_error" }),
      error
    );
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
