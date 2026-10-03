import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextRequest } from "next/server";

import { GET } from "@/app/api/inpaint/[requestId]/status/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  _resetInpaintStatusRateLimitForTests,
  _setStatusGoneRetryDelaysForTests,
} from "@/lib/inpaint-status";

// The inpaint status route goes through the inference abstraction.
// We mock the abstraction so the test does not depend on a real
// fal or Replicate token. The mock returns a stub client whose
// `status` and `result` are `vi.fn()`s we can configure per-test.
const mockInferenceStatus = vi.hoisted(() => vi.fn());
const mockInferenceResult = vi.hoisted(() => vi.fn());

vi.mock("@/lib/inference", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inference")>();
  return {
    ...actual,
    getInferenceClient: vi.fn(async () => ({
      subscribe: vi.fn(),
      submit: vi.fn(),
      status: mockInferenceStatus,
      result: mockInferenceResult,
    })),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inpaintRequest: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(),
}));

const falQueueStatus = mockInferenceStatus as unknown as Mock;
const falQueueResult = mockInferenceResult as unknown as Mock;
const findUnique = prisma.inpaintRequest.findUnique as unknown as Mock;
const update = prisma.inpaintRequest.update as unknown as Mock;
const authedUser = getAuthedPrismaUser as unknown as Mock;

const USER_ID = "user-1";
const REQUEST_ID = "req-1";

/**
 * Minimal stand-in for `@fal-ai/client`'s `ApiError` so the route's
 * "is this a 404 from the fal queue?" detection runs without depending
 * on the real class. Carries the same `status: number` field the
 * production check inspects.
 */
class FakeFalApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly requestId: string;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = null;
    this.requestId = REQUEST_ID;
  }
}

/** An owned, in-flight InpaintRequest row (the happy polling path). */
function ownedRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "IN_PROGRESS",
    resultUrl: null,
    // `updatedAt` is the timestamp the row last transitioned. The
    // PERSISTENCE_FAILED give-up check (#1187 follow-up) reads it to
    // decide whether to stop retrying persistence and return
    // `completed, persisted: false`. Tests use a recent timestamp by
    // default so the retry path is exercised; the bound's own test
    // passes an old `updatedAt` to flip into the give-up branch.
    updatedAt: new Date(),
    room: { project: { userId: USER_ID } },
    ...overrides,
  };
}

async function callStatusRoute(): Promise<Response> {
  const request = new Request(
    `http://localhost/api/inpaint/${REQUEST_ID}/status`
  );
  return GET(request as unknown as NextRequest, {
    params: Promise.resolve({ requestId: REQUEST_ID }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  // #1202: the 404-recovery retries sleep between attempts; keep tests instant.
  _setStatusGoneRetryDelaysForTests([0, 0]);
  // The status route rate-limits per (user, request); 10 calls/min would
  // otherwise start returning 429 partway through this file.
  _resetInpaintStatusRateLimitForTests();
  authedUser.mockResolvedValue({ id: USER_ID });
  findUnique.mockResolvedValue(ownedRow());
  update.mockResolvedValue({});
});

describe("GET /api/inpaint/[requestId]/status — fal ERROR terminal state (issue #686)", () => {
  it("persists ERROR to the row and responds with a terminal payload", async () => {
    falQueueStatus.mockResolvedValue({ status: "ERROR" });

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      status: "ERROR",
      code: "inpaint-terminal-error",
      error: "Inpainting failed",
      message: "The image editing process encountered an error. Please try again.",
      retryable: false,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: REQUEST_ID },
      data: { status: "ERROR" },
    });
  });

  it("still responds terminal when the row update fails (best-effort persist)", async () => {
    falQueueStatus.mockResolvedValue({ status: "ERROR" });
    update.mockRejectedValue(new Error("db down"));

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.status).toBe("ERROR");
    expect(body.retryable).toBe(false);
  });

  it("returns the terminal payload immediately without calling fal when the row is already ERROR", async () => {
    findUnique.mockResolvedValue(ownedRow({ status: "ERROR" }));

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      status: "ERROR",
      code: "inpaint-terminal-error",
      error: "Inpainting failed",
      message: "The image editing process encountered an error. Please try again.",
      retryable: false,
    });
    expect(falQueueStatus).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("GET /api/inpaint/[requestId]/status — COMPLETED result-endpoint failure (issue #717)", () => {
  it("logs inpaint_result_fetch_failed and responds with the retryable 500 when the result fetch fails", async () => {
    falQueueStatus.mockResolvedValue({ status: "COMPLETED" });
    const resultError = new Error("fal result endpoint unavailable");
    falQueueResult.mockRejectedValue(resultError);

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "retryable",
      persisted: false,
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      JSON.stringify({
        event: "inpaint_result_fetch_failed",
        requestId: REQUEST_ID,
      }),
      resultError
    );

    consoleError.mockRestore();
  });

  it("returns completed with persisted:false when COMPLETED but persistence fails (no retry loop)", async () => {
    // The fal job is done. Persistence to Supabase failed (env, creds,
    // bucket, network — anything). The user's poller was looping
    // forever on `{ status: "retryable", imageUrl, persisted: false }`
    // because the literal body `status` "retryable" plus HTTP 200
    // classified as `pending` in the client. Return `completed` with
    // `persisted: false` instead — the client poller terminates, the
    // editor surfaces the expiring-URL warning (issue #687), and the
    // user gets their result rather than a permanent spinner.
    const FAL_IMAGE_URL =
      "https://v3b.fal.media/files/b/0aaccee2/lcM-XoPzunOEy0PTWfMTy.jpg";
    falQueueStatus.mockResolvedValue({ status: "COMPLETED" });
    falQueueResult.mockResolvedValue({ data: { images: [{ url: FAL_IMAGE_URL }] } });

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "completed",
      imageUrl: FAL_IMAGE_URL,
      persisted: false,
    });
    // The row is recorded as PERSISTENCE_FAILED so a future
    // upload retry (e.g. after Supabase is restored) can still
    // complete it. The route attempts the update but tolerates a
    // DB failure (logs it) — the response is the same either way.
    expect(update).toHaveBeenCalledWith({
      where: { id: REQUEST_ID },
      data: { status: "PERSISTENCE_FAILED", resultUrl: null },
    });
  });
});

describe("GET /api/inpaint/[requestId]/status — in-flight queue passthrough", () => {
  it("echoes the fal queue status for an IN_PROGRESS job so the client keeps polling", async () => {
    // The @fal-ai/client@1.x `queue.status` returns
    // "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" — never "ERROR" and never
    // "retryable". Collapsing any in-flight status to "retryable" makes the
    // client classify the response as `pending` with status "retryable",
    // which renders as "Processing: retryable" forever, hiding the real
    // queue state and burning the full maxAttempts budget on a healthy
    // job. The route must pass the fal status through verbatim.
    falQueueStatus.mockResolvedValue({
      status: "IN_PROGRESS",
      request_id: REQUEST_ID,
      response_url: "https://fal.example/response",
      status_url: "https://fal.example/status",
      cancel_url: "https://fal.example/cancel",
      logs: [],
    });

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "IN_PROGRESS" });
    expect(body).not.toMatchObject({ status: "retryable" });
  });

  it("echoes the fal queue status for an IN_QUEUE job", async () => {
    falQueueStatus.mockResolvedValue({
      status: "IN_QUEUE",
      request_id: REQUEST_ID,
      response_url: "https://fal.example/response",
      status_url: "https://fal.example/status",
      cancel_url: "https://fal.example/cancel",
      queue_position: 3,
    });

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "IN_QUEUE" });
  });
});

describe("GET /api/inpaint/[requestId]/status — fal reports the job is gone", () => {
  // The fal queue prunes requestIds after their TTL (default 1 hour). An
  // InpaintRequest row can outlive the queue entry (e.g. the user closed
  // the tab and came back later, or the request was queued successfully
  // but the queue rejected it asynchronously). The poller must mark the
  // row ERROR and respond terminal, otherwise the client polls a phantom
  // job forever, isProcessing stays true, and the editor's "Restage
  // furnishings" button is permanently disabled.

  it("marks the row ERROR only after status retries AND result all 404", async () => {
    const falError = new FakeFalApiError(404, "Not Found");
    falQueueStatus.mockRejectedValue(falError);
    falQueueResult.mockRejectedValue(new FakeFalApiError(404, "Not Found"));

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      status: "ERROR",
      code: "inpaint-terminal-error",
      error: "Inpainting failed",
      message:
        "The image editing process encountered an error. Please try again.",
      retryable: false,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: REQUEST_ID },
      data: { status: "ERROR" },
    });
  });

  it("still responds terminal when the row update fails (best-effort persist)", async () => {
    const falError = new FakeFalApiError(404, "Not Found");
    falQueueStatus.mockRejectedValue(falError);
    falQueueResult.mockRejectedValue(new FakeFalApiError(404, "Not Found"));
    update.mockRejectedValue(new Error("db down"));

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.status).toBe("ERROR");
    expect(body.retryable).toBe(false);
  });

  it("treats a PERSISTENCE_FAILED row whose result endpoint returns 404 as terminal", async () => {
    findUnique.mockResolvedValue(ownedRow({ status: "PERSISTENCE_FAILED" }));
    falQueueResult.mockRejectedValue(new FakeFalApiError(404, "Not Found"));

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.status).toBe("ERROR");
    expect(body.retryable).toBe(false);
    expect(update).toHaveBeenCalledWith({
      where: { id: REQUEST_ID },
      data: { status: "ERROR" },
    });
  });
});

describe("GET /api/inpaint/[requestId]/status — PERSISTENCE_FAILED give-up bound", () => {
  // PERSISTENCE_FAILED retries persistence on every poll. If Supabase
  // is the failure mode (env, credentials, bucket policy, network) the
  // poller otherwise loops forever, the editor's button is permanently
  // disabled, and the user sees "Processing: retryable" indefinitely.
  // The bound stops the loop after a configured wall-clock window by
  // returning the fal CDN URL with `persisted: false` (issue #687) so
  // the client poller terminates and the editor surfaces the
  // expiring-URL warning instead.
  const FAL_IMAGE_URL =
    "https://v3b.fal.media/files/b/0aaccee2/lcM-XoPzunOEy0PTWfMTy.jpg";

  it("returns the fal CDN URL with persisted: false once the give-up window has elapsed", async () => {
    // The rate limiter keys on (userId, requestId); use a fresh pair
    // so this test's bound check runs without inheriting hits from
    // earlier tests in this file.
    authedUser.mockResolvedValue({ id: "user-bound" });
    const oldUpdatedAt = new Date(Date.now() - 3 * 60 * 1000); // 3 minutes ago
    findUnique.mockResolvedValue({
      status: "PERSISTENCE_FAILED",
      resultUrl: null,
      updatedAt: oldUpdatedAt,
      room: { project: { userId: "user-bound" } },
    });
    const falResult = mockInferenceResult as unknown as Mock;
    falResult.mockResolvedValue({
      data: { images: [{ url: FAL_IMAGE_URL }] },
    });

    const request = new Request(
      "http://localhost/api/inpaint/req-bound/status"
    );
    const response = await GET(request as unknown as NextRequest, {
      params: Promise.resolve({ requestId: "req-bound" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "completed",
      imageUrl: FAL_IMAGE_URL,
      persisted: false,
    });
    // The row stays in PERSISTENCE_FAILED so a future upload retry
    // (e.g. after Supabase is restored) can still complete it.
    expect(update).not.toHaveBeenCalled();
  });
});

describe("GET /api/inpaint/[requestId]/status — recovering from a transient status 404 (#1202)", () => {
  // A 404 from `status` is not a 404 from `result`. The poller must
  // retry status, then ask result, before declaring the work lost.

  function mockPersistenceSucceeds() {
    // persistFalImage downloads the provider URL, then uploads to Supabase.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }))
    );
  }

  it("recovers via result when status 404s on every try but result still has the image", async () => {
    falQueueStatus.mockRejectedValue(new FakeFalApiError(404, "Not Found"));
    falQueueResult.mockResolvedValue({
      data: { images: [{ url: "https://fal.media/files/recovered.png" }] },
    });

    const response = await callStatusRoute();
    const body = await response.json();

    expect(body.status).not.toBe("ERROR");
    expect(body.status).toBe("completed");
    // 1 initial status call + 2 retries, then exactly one result call.
    expect(falQueueStatus).toHaveBeenCalledTimes(3);
    expect(falQueueResult).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalledWith({
      where: { id: REQUEST_ID },
      data: { status: "ERROR" },
    });
  });

  it("carries on normally when a status retry succeeds after one 404", async () => {
    falQueueStatus
      .mockRejectedValueOnce(new FakeFalApiError(404, "Not Found"))
      .mockResolvedValueOnce({ status: "IN_PROGRESS" });

    const response = await callStatusRoute();
    const body = await response.json();

    expect(body.status).toBe("IN_PROGRESS");
    expect(falQueueStatus).toHaveBeenCalledTimes(2);
    expect(falQueueResult).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("persists the recovered image on the existing row with status COMPLETED", async () => {
    mockPersistenceSucceeds();
    falQueueStatus.mockRejectedValue(new FakeFalApiError(404, "Not Found"));
    falQueueResult.mockResolvedValue({
      data: { images: [{ url: "https://fal.media/files/recovered.png" }] },
    });

    const response = await callStatusRoute();
    const body = await response.json();
    vi.unstubAllGlobals();

    expect(body.status).toBe("completed");
    const statuses = update.mock.calls.map((c) => c[0]?.data?.status);
    expect(statuses).not.toContain("ERROR");
    expect(statuses.some((st) => st === "COMPLETED" || st === "PERSISTENCE_FAILED")).toBe(true);
  });

  it("bounds the recovery cost: at most 3 status calls and 1 result call", async () => {
    falQueueStatus.mockRejectedValue(new FakeFalApiError(404, "Not Found"));
    falQueueResult.mockRejectedValue(new FakeFalApiError(404, "Not Found"));

    await callStatusRoute();

    expect(falQueueStatus).toHaveBeenCalledTimes(3);
    expect(falQueueResult).toHaveBeenCalledTimes(1);
  });
});
