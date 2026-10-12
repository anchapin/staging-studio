/**
 * Inpaint completion webhook (issue #1221) — POST /api/inpaint/webhook
 *
 * Contract under test:
 * - 401 on any signature failure; nothing is written on rejection
 * - 503 when INPAINT_WEBHOOK_SECRET is unset (not configured)
 * - 400 on unparseable payloads; nothing written
 * - unknown providerJobId → 200 not_found (row deleted mid-flight)
 * - completed delivery → same persistence contract as the poller:
 *   persistFalImage, then a durable COMPLETED+resultUrl write
 * - durable-write failure → 503; the provider's retry re-runs the
 *   path (issue #1136 rule: never report completion after a failed write)
 * - persistence failure → 503 + row PERSISTENCE_FAILED
 * - idempotent redelivery for an already-terminal row → 200 noop
 * - provider error delivery → row ERROR, 200
 */

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextRequest } from "next/server";
import { webcrypto } from "node:crypto";

const mockPersistFalImage = vi.hoisted(() => vi.fn());
// Issue #1116: the completion/error transitions log a pipeline event
// via the shared inpaint-status helper; stubbed here, pinned below.
const mockLogInpaintTransition = vi.hoisted(() => vi.fn(async () => {}));
const mockPrisma = vi.hoisted(() => ({
  inpaintRequest: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/inpaint-status", () => ({
  persistFalImage: mockPersistFalImage,
  logInpaintTransition: mockLogInpaintTransition,
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { POST, parseInpaintWebhookBody } from "@/app/api/inpaint/webhook/route";
import {
  signWebhookPayload,
  WEBHOOK_SIGNATURE_HEADER,
} from "@/lib/webhook-signature";
import type { InpaintWebhookOutcome } from "@/lib/inpaint-webhook";

const SECRET = "whsec_test_secret_123";
const JOB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ROW_ID = "f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0";
const CDN_URL = "https://v3.fal.media/files/generated.png";
const PERSISTED_URL = "https://xxxx.supabase.co/storage/v1/object/public/staging-images/after-abc.png";

async function signedRequest(body: string, sentAtSeconds?: number): Promise<NextRequest> {
  const header = await signWebhookPayload(body, SECRET, sentAtSeconds);
  return {
    text: async () => body,
    headers: new Headers({ [WEBHOOK_SIGNATURE_HEADER]: header }),
  } as unknown as NextRequest;
}

function falDelivery(
  output: unknown,
  status = "COMPLETED",
  responseUrl?: string
): string {
  return JSON.stringify({
    type: "queue.status.updated",
    status,
    request_id: JOB_ID,
    output,
    ...(responseUrl ? { response_url: responseUrl } : {}),
  });
}

async function readOutcome(response: Response): Promise<{
  status: number;
  body: { ok?: boolean; kind?: InpaintWebhookOutcome["kind"]; error?: string };
}> {
  return { status: response.status, body: await response.json() };
}

const IN_QUEUE_ROW = { id: ROW_ID, status: "IN_QUEUE", resultUrl: null };
const COMPLETED_ROW = { id: ROW_ID, status: "COMPLETED", resultUrl: PERSISTED_URL };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INPAINT_WEBHOOK_SECRET = SECRET;
  mockPrisma.inpaintRequest.findUnique.mockResolvedValue(IN_QUEUE_ROW);
  mockPrisma.inpaintRequest.update.mockResolvedValue({});
  mockPersistFalImage.mockResolvedValue({ persisted: true, imageUrl: PERSISTED_URL });
});

describe("POST /api/inpaint/webhook", () => {
  it("returns 503 and writes nothing when no secret is configured", async () => {
    delete process.env.INPAINT_WEBHOOK_SECRET;
    const body = falDelivery({ image: { url: CDN_URL } });
    const unsigned = {
      text: async () => body,
      headers: new Headers(),
    } as unknown as NextRequest;

    const response = await POST(unsigned);
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(503);
    expect(mockPrisma.inpaintRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.inpaintRequest.update).not.toHaveBeenCalled();
  });

  it("rejects an unsigned delivery with 401 and writes nothing", async () => {
    const body = falDelivery({ image: { url: CDN_URL } });
    const unsigned = {
      text: async () => body,
      headers: new Headers(),
    } as unknown as NextRequest;

    const response = await POST(unsigned);
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(401);
    expect(mockPrisma.inpaintRequest.update).not.toHaveBeenCalled();
  });

  it("rejects a tampered payload with 401 and writes nothing", async () => {
    const legit = falDelivery({ image: { url: CDN_URL } });
    const header = await signWebhookPayload(legit, SECRET);
    const tampered = legit.replace(JOB_ID, "attacker-controlled-id");
    const request = {
      text: async () => tampered,
      headers: new Headers({ [WEBHOOK_SIGNATURE_HEADER]: header }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(401);
    expect(mockPrisma.inpaintRequest.update).not.toHaveBeenCalled();
  });

  it("rejects an old (replayed) delivery with 401", async () => {
    const body = falDelivery({ image: { url: CDN_URL } });
    // The route verifies against the current clock; sign 6 minutes ago.
    const staleSeconds = Math.floor(Date.now() / 1000) - 6 * 60;
    const request = await signedRequest(body, staleSeconds);
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 for a payload with no job id and writes nothing", async () => {
    const body = JSON.stringify({ type: "queue.status.updated", status: "COMPLETED" });
    const response = await POST(await signedRequest(body));
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(400);
    expect(mockPrisma.inpaintRequest.findUnique).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await POST(await signedRequest("not-json{"));
    expect((await readOutcome(response)).status).toBe(400);
  });

  it("returns not_found (200) for an unknown job id", async () => {
    mockPrisma.inpaintRequest.findUnique.mockResolvedValue(null);
    const response = await POST(await await signedRequest(falDelivery({ image: { url: CDN_URL } })));
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(200);
    expect(outcome.body.kind).toBe("not_found");
    expect(mockPrisma.inpaintRequest.update).not.toHaveBeenCalled();
  });

  it("persists and marks the row COMPLETED on a completed delivery", async () => {
    const response = await POST(await await signedRequest(falDelivery({ image: { url: CDN_URL } })));
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(200);
    expect(outcome.body.kind).toBe("completed");
    expect(mockPersistFalImage).toHaveBeenCalledWith(CDN_URL, ROW_ID);
    expect(mockPrisma.inpaintRequest.update).toHaveBeenCalledWith({
      where: { id: ROW_ID },
      data: { status: "COMPLETED", resultUrl: PERSISTED_URL },
    });
  });

  it("logs the completed pipeline event on a completed delivery (issue #1116)", async () => {
    const response = await POST(await await signedRequest(falDelivery({ image: { url: CDN_URL } })));
    expect(response.status).toBe(200);
    expect(mockLogInpaintTransition).toHaveBeenCalledWith(ROW_ID, "completed");
  });

  it("is idempotent: an already-COMPLETED row is a 200 noop with no re-upload", async () => {
    mockPrisma.inpaintRequest.findUnique.mockResolvedValue(COMPLETED_ROW);
    const response = await POST(await await signedRequest(falDelivery({ image: { url: CDN_URL } })));
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(200);
    expect(outcome.body.kind).toBe("noop");
    expect(mockPersistFalImage).not.toHaveBeenCalled();
    expect(mockPrisma.inpaintRequest.update).not.toHaveBeenCalled();
  });

  it("returns 503 and marks PERSISTENCE_FAILED when the storage upload fails", async () => {
    mockPersistFalImage.mockResolvedValue({ persisted: false, imageUrl: null });
    const response = await POST(await await signedRequest(falDelivery({ image: { url: CDN_URL } })));
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(503);
    // Issue #1143: the webhook's failure write also memoizes the URL
    // and seeds the attempt bookkeeping.
    expect(mockPrisma.inpaintRequest.update).toHaveBeenCalledWith({
      where: { id: ROW_ID },
      data: {
        status: "PERSISTENCE_FAILED",
        resultUrl: null,
        falResultUrl: null, // persistFalImage failed with imageUrl: null, so nothing to memoize
        persistenceAttempts: { increment: 1 },
        lastPersistenceAttemptAt: expect.any(Date),
      },
    });
  });

  it("returns 503 when the durable COMPLETED write itself fails (#1136 rule)", async () => {
    mockPrisma.inpaintRequest.update
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValue({});
    const response = await POST(await await signedRequest(falDelivery({ image: { url: CDN_URL } })));
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(503);
    expect(outcome.body.kind).toBe("write_failed");
  });

  it("marks the row ERROR on a provider error delivery", async () => {
    const response = await POST(await await signedRequest(falDelivery({ error: "OOM" }, "ERROR")));
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(200);
    expect(outcome.body.kind).toBe("provider_error");
    expect(mockPrisma.inpaintRequest.update).toHaveBeenCalledWith({
      where: { id: ROW_ID },
      data: { status: "ERROR" },
    });
  });

  it("accepts a mid-flight fal status as a 200 no-op", async () => {
    const response = await POST(await await signedRequest(falDelivery(undefined, "IN_PROGRESS")));
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(200);
    expect(outcome.body.kind).toBe("in_progress");
    expect(mockPrisma.inpaintRequest.update).not.toHaveBeenCalled();
  });

  it("returns 400 for a delivery with neither an image, a known status, nor an error", async () => {
    const response = await POST(await await signedRequest(falDelivery(undefined, "SOMETHING_ELSE")));
    const outcome = await readOutcome(response);
    expect(outcome.status).toBe(400);
    expect(outcome.body.kind).toBe("unrecognized");
    expect(mockPrisma.inpaintRequest.update).not.toHaveBeenCalled();
  });

  it("fetches fal's response_url when a completed delivery carries no inline image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ images: [{ url: CDN_URL }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await POST(
        await await signedRequest(falDelivery(null, "OK", "https://queue.fal.run/requests/req/result"))
      );
      const outcome = await readOutcome(response);
      expect(outcome.status).toBe(200);
      expect(outcome.body.kind).toBe("completed");
      expect(fetchMock).toHaveBeenCalledWith("https://queue.fal.run/requests/req/result");
      expect(mockPrisma.inpaintRequest.update).toHaveBeenCalledWith({
        where: { id: ROW_ID },
        data: { status: "COMPLETED", resultUrl: PERSISTED_URL },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns 503 when fal's response_url is unfetchable, so the provider redelivers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await POST(
        await await signedRequest(falDelivery(null, "OK", "https://queue.fal.run/requests/req/result"))
      );
      const outcome = await readOutcome(response);
      expect(outcome.status).toBe(503);
      expect(outcome.body.kind).toBe("result_fetch_failed");
      expect(mockPrisma.inpaintRequest.update).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("parseInpaintWebhookBody", () => {
  it("reads fal's envelope (request_id at top level)", () => {
    const parsed = parseInpaintWebhookBody({
      type: "queue.status.updated",
      status: "COMPLETED",
      request_id: JOB_ID,
      output: { image: { url: CDN_URL } },
    });
    expect(parsed).toEqual({
      providerJobId: JOB_ID,
      status: "COMPLETED",
      output: { image: { url: CDN_URL } },
      responseUrl: null,
    });
  });

  it("reads Replicate's envelope (id, nested payload)", () => {
    const parsed = parseInpaintWebhookBody({
      id: "pred_123",
      payload: { id: "pred_123", status: "succeeded", output: [CDN_URL] },
    });
    expect(parsed?.providerJobId).toBe("pred_123");
    expect(parsed?.status).toBe("succeeded");
  });

  it("returns null when no job id is present", () => {
    expect(parseInpaintWebhookBody({ status: "COMPLETED" })).toBeNull();
    expect(parseInpaintWebhookBody({ request_id: "" })).toBeNull();
  });
});
