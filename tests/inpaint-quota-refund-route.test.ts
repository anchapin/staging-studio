/**
 * Issue #1421 — quota refund on the inpaint route's failure paths.
 *
 * Two of the three unrefunded paths live in the route's background
 * tick:
 *
 *   PATH 1 — the provider REJECTS the submit (no job exists upstream):
 *             the row is flipped to ERROR and the reserved
 *             `DAILY_INPAINT_LIMIT` unit is released.
 *   PATH 3 — the provider ACCEPTED the job but the post-submit
 *             `providerJobId` row write failed: the upstream job is
 *             cancelled (the only way to stop the money) and the unit
 *             is released.
 *
 * The suite drives the REAL route (`POST /api/inpaint`) with the
 * provider, the database and the quota ledger mocked, so it needs no
 * live database and no generated Prisma client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({
  submit: vi.fn(),
  cancel: vi.fn(),
  getInferenceClient: vi.fn(),
  refundDailyQuota: vi.fn(),
  claimDailyQuota: vi.fn(),
  inpaintCreate: vi.fn(),
  inpaintUpdate: vi.fn(),
  roomFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inpaintRequest: {
      count: vi.fn(async () => 0),
      create: (...args: unknown[]) => mock.inpaintCreate(...args),
      update: (...args: unknown[]) => mock.inpaintUpdate(...args),
      findFirst: vi.fn(async () => null),
    },
    room: { findFirst: (...args: unknown[]) => mock.roomFindFirst(...args) },
    userUsage: { findFirst: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    dailyApiUsage: {
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({ count: 1 })),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(async () => ({
    id: "user-1421",
    email: "test@example.com",
    firmName: "Test Firm",
    ownerName: "Test Owner",
  })),
}));

// The quota ledger is mocked: the refund spy is the assertion surface
// for "the reserved unit came back".
vi.mock("@/lib/api-quota", () => ({
  DEFAULT_DAILY_INPAINT_LIMIT: 20,
  DAILY_LIMIT_ENV_VAR: { inpaint: "DAILY_INPAINT_LIMIT" },
  resolveDailyLimit: vi.fn((_raw: string | undefined, fallback: number) => fallback),
  evaluateDailyQuota: vi.fn(() => ({ allowed: true, used: 0, limit: 20, remaining: 20 })),
  dailyQuotaExceededPayload: vi.fn(() => ({ code: "DAILY_LIMIT_EXCEEDED" })),
  getDailyUsage: vi.fn(async () => 0),
  recordDailyUsage: vi.fn(async () => 1),
  claimDailyQuota: (...args: unknown[]) => mock.claimDailyQuota(...args),
  refundDailyQuota: (...args: unknown[]) => mock.refundDailyQuota(...args),
}));

vi.mock("@/lib/inference", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inference")>();
  return {
    ...actual,
    getInferenceClient: (...args: unknown[]) => mock.getInferenceClient(...args),
  };
});

vi.mock("@/lib/inpaint-quality-gate", () => ({
  evaluateInpaintQualityGate: vi.fn(async () => []),
}));

vi.mock("@/lib/prompts", () => ({
  FAL_FLUX_FILL_MODEL: "fal-ai/flux-lora-fill",
  buildInpaintPrompt: vi.fn(() => "replace sofa with leather sofa"),
  buildFalFillPayload: vi.fn(() => ({})),
  buildInpaintPayloadForActiveProvider: vi.fn(() => ({
    image_url: "https://example.com/slot0.png",
    mask_url: "https://example.com/mask.png",
    prompt: "replace sofa",
    negative_prompt: "",
    guidance: 7.5,
    num_inference_steps: 28,
  })),
}));

import { POST } from "@/app/api/inpaint/route";

const MOCK_USER_ID = "user-1421";
const MOCK_ROOM_ID = "room-1421";

const BASE_BODY = {
  roomId: MOCK_ROOM_ID,
  sourceSlot: 0,
  variantSlot: 0,
  imageUrl:
    "https://example.supabase.co/storage/v1/object/public/staging-images/room.png",
  maskUrl: "data:image/png;base64,BBB",
  promptDirectives: "replace sofa with leather sofa",
  aesthetic: "mid-century modern",
};

function makeRequest(overrides: Record<string, unknown> = {}): NextRequest {
  return {
    method: "POST",
    url: "http://localhost/api/inpaint",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve({ ...BASE_BODY, ...overrides }),
  } as unknown as NextRequest;
}

/**
 * Waits for the route's fire-and-forget background tick to settle.
 * The tick is a detached promise, so the assertions have to poll.
 */
async function flushBackgroundTick(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.claimDailyQuota.mockResolvedValue({
    claimed: true,
    allowed: true,
    used: 0,
    limit: 20,
    remaining: 20,
  });
  mock.refundDailyQuota.mockResolvedValue(undefined);
  mock.roomFindFirst.mockResolvedValue({
    id: MOCK_ROOM_ID,
    name: "Living Room",
    afterImageUrl: "https://example.com/slot0.png",
    afterImageUrl2: "https://example.com/slot1.png",
  });
  mock.inpaintCreate.mockResolvedValue({});
  mock.inpaintUpdate.mockResolvedValue({});
  mock.getInferenceClient.mockResolvedValue({
    submit: (...args: unknown[]) => mock.submit(...args),
  });
});

describe("POST /api/inpaint — quota refund on the failure paths (issue #1421)", () => {
  it("PATH 1: releases the reserved unit when the provider rejects the submit", async () => {
    // A 401 is not retried by `submitWithRetry`, so the background
    // tick fails fast — exactly like a provider outage/5xx would.
    const providerError = Object.assign(new Error("provider rejected the submit"), {
      status: 401,
    });
    mock.submit.mockRejectedValue(providerError);

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    await flushBackgroundTick();

    // The unit was claimed up front (issue #1111)...
    expect(mock.claimDailyQuota).toHaveBeenCalledTimes(1);
    // ...and released again because no job was ever created.
    expect(mock.refundDailyQuota).toHaveBeenCalledTimes(1);
    expect(mock.refundDailyQuota).toHaveBeenCalledWith(
      "inpaint",
      MOCK_USER_ID,
      1,
      expect.any(Date)
    );
    // The row is terminal so the poller stops spinning.
    const errorFlip = mock.inpaintUpdate.mock.calls.find(
      (call) => (call[0] as { data?: { status?: string } })?.data?.status === "ERROR"
    );
    expect(errorFlip).toBeTruthy();
  });

  it("PATH 3: releases the reserved unit and cancels the provider job when the post-submit write fails", async () => {
    mock.submit.mockResolvedValue({ request_id: "provider-job-1421" });
    mock.cancel.mockResolvedValue({ cancelled: true, reason: "cancelled upstream" });
    mock.getInferenceClient.mockResolvedValue({
      submit: (...args: unknown[]) => mock.submit(...args),
      cancel: (...args: unknown[]) => mock.cancel(...args),
    });
    // The providerJobId write fails PERMANENTLY (P2002 is not
    // retryable), so the retry helper gives up immediately.
    mock.inpaintUpdate.mockRejectedValue(
      Object.assign(new Error("unique constraint failed"), { code: "P2002" })
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    await flushBackgroundTick();

    // The upstream job is cancelled first — that is the only way to
    // stop the money for a job no DB row can map to.
    expect(mock.cancel).toHaveBeenCalledWith("flux-fill", "provider-job-1421");
    // ...and the user's reserved unit comes back.
    expect(mock.refundDailyQuota).toHaveBeenCalledTimes(1);
    expect(mock.refundDailyQuota).toHaveBeenCalledWith(
      "inpaint",
      MOCK_USER_ID,
      1,
      expect.any(Date)
    );
  });

  it("PATH 3: a transient post-submit write failure is retried and does NOT refund", async () => {
    mock.submit.mockResolvedValue({ request_id: "provider-job-1421" });
    mock.inpaintUpdate
      .mockRejectedValueOnce(Object.assign(new Error("write conflict"), { code: "P2034" }))
      .mockResolvedValueOnce({});

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    // The retry sleeps INPAINT_PROVIDER_JOB_WRITE_RETRY_DELAY_MS (200ms)
    // before its second attempt, so poll in real time until it lands.
    for (let i = 0; i < 100 && mock.inpaintUpdate.mock.calls.length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await flushBackgroundTick();

    // The write was retried and landed...
    expect(mock.inpaintUpdate).toHaveBeenCalledTimes(2);
    // ...so the job is alive and the unit stays claimed.
    expect(mock.refundDailyQuota).not.toHaveBeenCalled();
  });

  it("does NOT refund when the submit succeeds", async () => {
    mock.submit.mockResolvedValue({
      request_id: "provider-job-1421",
      result: { imageUrl: "https://example.com/out.png", width: null, height: null },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    await flushBackgroundTick();

    expect(mock.claimDailyQuota).toHaveBeenCalledTimes(1);
    expect(mock.refundDailyQuota).not.toHaveBeenCalled();
  });
});
