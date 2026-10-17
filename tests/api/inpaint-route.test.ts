/**
 * Inpaint Route — POST /api/inpaint
 *
 * Coverage:
 * - 401 unauthenticated
 * - 400 Zod validation failures (missing roomId, invalid sourceSlot range, etc.)
 * - 429 daily inpaint quota exceeded
 * - 404 room not found
 * - 400 invalid source (variant slot has no staged result)
 * - 200 response after fire-and-forget submit (#1262 — the quality
 *   gate is no longer on the synchronous path; the response always
 *   reports `qualityWarnings: []`).
 * - 200 with the pre-allocated requestId when the background submit
 *   rejects (#1262).
 * - userUsage upserted after success
 * - 500 on fal submission failure
 *
 * Issue #1362b: the inpaint request schema is now `.strict()` and
 * drops `creativeMode` / `lockSeed` / `maskBlur` / `promptStrength`.
 * Tests that previously sent `creativeMode: true|false` in the body
 * are still named around the "quality gate" UX so the test surface
 * stays recognizable, but the body field is no longer forwarded —
 * the gate decision is now driven by route-level config, not the
 * payload. See `src/lib/ai-route-schemas.ts` for the wire schema.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/inpaint/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

// The inpaint route now goes through the inference abstraction. We
// mock the abstraction so the test does not depend on a real fal or
// Replicate token. The mock returns a stub client whose `submit` is
// a `vi.fn()` we configure per-test below.
const fakeSubmit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/inference", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inference")>();
  return {
    ...actual,
    getInferenceClient: vi.fn(async () => ({
      subscribe: vi.fn(),
      submit: fakeSubmit,
      status: vi.fn(),
      result: vi.fn(),
    })),
  };
});

import { evaluateInpaintQualityGate } from "@/lib/inpaint-quality-gate";
import { resolveDailyLimit, evaluateDailyQuota, getDailyUsage, recordDailyUsage } from "@/lib/api-quota";
import { buildInpaintPrompt } from "@/lib/prompts";

// The legacy `falQueueSubmitWithCircuitBreaker` import from
// `@/lib/fal` is no longer the call site — the route uses the
// abstraction. Existing test bodies read as "the fal submit was
// called", and they poke `falQueueSubmitWithCircuitBreaker` for
// assertion; aliasing to `fakeSubmit` keeps those lines reading the
// same without churn.
const falQueueSubmitWithCircuitBreaker = fakeSubmit as unknown as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";

const mockUser = {
  id: MOCK_USER_ID,
  email: "test@example.com",
  firmName: "Test Firm",
  ownerName: "Test Owner",
  logoUrl: null,
  psychologyPageContent: null,
  signoffContent: null,
  darkMode: false,
  createdAt: new Date(),
};

// Room with both variant slots populated so source-slot validation can be tested
const mockRoom = {
  id: MOCK_ROOM_ID,
  name: "Living Room",
  afterImageUrl: "https://xxxx.supabase.co/storage/slot0.png",
  afterImageUrl2: "https://xxxx.supabase.co/storage/slot1.png",
};

// ---------------------------------------------------------------------------
// Mock factories (return shapes that satisfy the route's usage)
// ---------------------------------------------------------------------------

function mockInpaintRequest(overrides = {}) {
  return {
    id: "req-1",
    userId: MOCK_USER_ID,
    roomId: MOCK_ROOM_ID,
    status: "PROCESSING",
    imageUrl: "https://xxxx.supabase.co/storage/out.png",
    resultUrl: null,
    maskImageUrl: null,
    providerJobId: null,
    prompt: "replace sofa with leather sofa",
    createdAt: new Date(),
    updatedAt: new Date(),
    degraded: false,
    qualityWarnings: [],
    seed: null,
    sourceSlot: 0,
    variantSlot: 0,
    aesthetic: "mid-century modern",
    negativePrompt: null,
    falRequestId: null,
    falResultUrl: null,
    persistenceAttempts: 0,
    lastPersistenceAttemptAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Request builder — all requests include the required inpaintRequestSchema fields
// ---------------------------------------------------------------------------

const BASE_BODY = {
  imageUrl: "https://xxxx.supabase.co/storage/room.png",
  maskUrl: "https://xxxx.supabase.co/storage/mask.png",
  promptDirectives: "replace sofa with leather sofa",
  aesthetic: "mid-century modern",
};

function makeRequest(overrides: Record<string, unknown> = {}): NextRequest {
  // Issue #1116: POST is wrapped in withRequestLogging, so the double
  // must carry the header/url surface the wrapper reads.
  return {
    method: "POST",
    url: "http://localhost/api/inpaint",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve({ ...BASE_BODY, ...overrides }),
  } as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockConsoleError = vi.fn();
vi.stubGlobal("console", { ...console, error: mockConsoleError });

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inpaintRequest: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      // Issue #1262: the fire-and-forget background tick calls
      // `prisma.inpaintRequest.update` to flip status / write
      // providerJobId / write resultUrl once the submit settles.
      update: vi.fn(),
    },
    room: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    userUsage: { findFirst: vi.fn(), upsert: vi.fn() },
    dailyApiUsage: { findFirst: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/lib/inpaint-quality-gate", () => ({
  evaluateInpaintQualityGate: vi.fn(),
}));

vi.mock("@/lib/prompts", () => ({
  FAL_FLUX_FILL_MODEL: "fal-ai/flux-lora-fill",
  buildInpaintPrompt: vi.fn(() => "replace sofa with leather sofa"),
  buildFalFillPayload: vi.fn(() => ({
    image_url: "https://xxxx.supabase.co/storage/slot0.png",
    mask_url: "https://xxxx.supabase.co/storage/mask.png",
    prompt: "replace sofa",
    negative_prompt: "",
    guidance: 7.5,
    num_inference_steps: 28,
  })),
  buildInpaintPayloadForActiveProvider: vi.fn(() => ({
    image_url: "https://xxxx.supabase.co/storage/slot0.png",
    mask_url: "https://xxxx.supabase.co/storage/mask.png",
    prompt: "replace sofa",
    negative_prompt: "",
    guidance: 7.5,
    num_inference_steps: 28,
  })),
}));

vi.mock("@/lib/api-quota", () => ({
  DEFAULT_DAILY_INPAINT_LIMIT: 20,
  DAILY_LIMIT_ENV_VAR: { inpaint: "DAILY_INPAINT_LIMIT" },
  resolveDailyLimit: vi.fn((_raw: string | undefined, fallback: number) => fallback),
  evaluateDailyQuota: vi.fn(),
  dailyQuotaExceededPayload: vi.fn((used: number, limit: number, resetsAt: string) => ({
    code: "DAILY_LIMIT_EXCEEDED",
    message: "Daily inpaint limit reached",
    limit,
    used,
    resetsAt,
  })),
  getDailyUsage: vi.fn(async () => 0),
  recordDailyUsage: vi.fn(async () => 1),
  // Issue #1111: the route now atomically CLAIMS via `claimDailyQuota`
  // (and refunds via `refundDailyQuota` on the pre-write failure path)
  // instead of using the post-submit `recordDailyUsage` upsert. Default
  // both to "claim succeeded" so existing happy-path tests stay green
  // without each one needing to set them up.
  claimDailyQuota: vi.fn(async () => ({
    claimed: true,
    allowed: true,
    used: 0,
    limit: 20,
    remaining: 20,
  })),
  refundDailyQuota: vi.fn(async () => {}),
}));

vi.mock("@/lib/error-classify", () => ({
  classifyIntegrationError: vi.fn((_ctx, err) => {
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      if (msg.includes("rate") || msg.includes("limit") || msg.includes("quota")) {
        return { type: "quota_exceeded" as const, message: "Daily inpaint limit reached. Please try again tomorrow.", status: 429, error: "QuotaExceeded", retryable: true };
      }
      if (msg.includes("timeout") || msg.includes("timed out")) {
        return { type: "timeout" as const, message: "AI service timed out. Please try again.", status: 408, error: "Timeout", retryable: true };
      }
      if (msg.includes("network") || msg.includes("fetch") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("etimedout")) {
        return { type: "network" as const, message: "AI service temporarily unavailable. Please try again later.", status: 503, error: "ServiceUnavailable", retryable: true };
      }
      return { type: "unknown" as const, message: "An unexpected error occurred. Please try again.", status: 500, error: "UnknownError", retryable: true };
    }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/inpaint", () => {
  beforeEach(() => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue(mockRoom as never);
    vi.mocked(getDailyUsage).mockResolvedValue(0);
    vi.mocked(prisma.inpaintRequest.create).mockResolvedValue(mockInpaintRequest());
    vi.mocked(prisma.inpaintRequest.update).mockResolvedValue(mockInpaintRequest());
    vi.mocked(prisma.dailyApiUsage.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.dailyApiUsage.upsert).mockResolvedValue({} as never);
    vi.mocked(evaluateInpaintQualityGate).mockResolvedValue([]);
    vi.mocked(falQueueSubmitWithCircuitBreaker).mockResolvedValue({
      request_id: "fal-req-123",
    } as never);
    vi.mocked(falQueueSubmitWithCircuitBreaker).mockResolvedValue({
      request_id: "fal-req-123",
    });
    vi.mocked(buildInpaintPrompt).mockReturnValue("replace sofa with leather sofa");
    vi.mocked(resolveDailyLimit).mockReturnValue(20);
    vi.mocked(evaluateDailyQuota).mockReturnValue({ allowed: true, used: 0, limit: 20, remaining: 20 });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 0, variantSlot: 0 }));

    expect(res.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Validation — Zod schema
  // -------------------------------------------------------------------------

  it("returns 400 when roomId is missing", async () => {
    const res = await POST(makeRequest({ sourceSlot: 0, variantSlot: 0 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when sourceSlot is out of range (> 1)", async () => {
    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 5, variantSlot: 0 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when variantSlot is out of range (> 1)", async () => {
    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 0, variantSlot: 3 }));
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Daily quota exceeded
  // -------------------------------------------------------------------------

  it("returns 429 when daily inpaint quota is exceeded", async () => {
    // Issue #1111: the route now atomically CLAIMS via claimDailyQuota
    // before the paid provider call; the prior
    // getDailyUsage+evaluateDailyQuota read-only check is gone. Make
    // the claim return denied so the route takes the 429 path.
    const { claimDailyQuota } = await import("@/lib/api-quota");
    vi.mocked(claimDailyQuota).mockResolvedValueOnce({
      claimed: false,
      allowed: false,
      used: 10,
      limit: 10,
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    });

    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 0, variantSlot: 0 }));

    expect(res.status).toBe(429);
    const json = await res.json();
    // The 429 body carries `code: API_ERROR_RATE_LIMIT_EXCEEDED`
    // ("rate-limit-exceeded"), the same code the other paid surfaces
    // set on their 429s — issue #1132. The mock's
    // `dailyQuotaExceededPayload` is also spread in first, so the
    // spread's `code` is overridden by the route's explicit override.
    expect(json.code).toBe("rate-limit-exceeded");
  });

  // -------------------------------------------------------------------------
  // Room not found
  // -------------------------------------------------------------------------

  it("returns 404 when room is not found", async () => {
    vi.mocked(getDailyUsage).mockResolvedValue(0);
    vi.mocked(prisma.room.findFirst).mockResolvedValue(null);

    const res = await POST(makeRequest({ roomId: "nonexistent", sourceSlot: 0, variantSlot: 0 }));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Room not found");
  });

  // -------------------------------------------------------------------------
  // Invalid source slot
  // -------------------------------------------------------------------------

  it("returns 400 when sourceSlot 0 is selected but room has no afterImageUrl", async () => {
    vi.mocked(getDailyUsage).mockResolvedValue(0);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
      ...mockRoom,
      afterImageUrl: null,
    } as never);

    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 0, variantSlot: 0 }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid source");
  });

  it("returns 400 when sourceSlot 1 is selected but room has no afterImageUrl2", async () => {
    vi.mocked(getDailyUsage).mockResolvedValue(0);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
      ...mockRoom,
      afterImageUrl2: null,
    } as never);

    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 1, variantSlot: 0 }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid source");
  });

  // -------------------------------------------------------------------------
  // Creative mode — quality gate skipped
  // -------------------------------------------------------------------------

  it("returns 200 and an empty qualityWarnings array when creativeMode=true (#1262)", async () => {
    // Issue #1262: the quality gate is no longer run on the synchronous
    // path — it would block the route behind an OpenAI call and defeat
    // the under-2s response budget. The response always reports
    // `qualityWarnings: []`.
    vi.mocked(getDailyUsage).mockResolvedValue(0);
    vi.mocked(evaluateInpaintQualityGate).mockResolvedValue([]);
    vi.mocked(falQueueSubmitWithCircuitBreaker).mockResolvedValue({
      request_id: "fal-req-123",
    } as never);

    const res = await POST(
      makeRequest({
        roomId: MOCK_ROOM_ID,
        sourceSlot: 0,
        variantSlot: 0,
        aesthetic: "mid-century modern",
      })
    );

    expect(res.status).toBe(200);
    expect(evaluateInpaintQualityGate).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.qualityWarnings).toEqual([]);
    expect(json.degraded).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Non-creative — quality gate runs, no warnings
  // -------------------------------------------------------------------------

  it("returns 200 with empty warnings when creativeMode=false (#1262)", async () => {
    vi.mocked(getDailyUsage).mockResolvedValue(0);
    vi.mocked(evaluateInpaintQualityGate).mockResolvedValue([]);
    vi.mocked(falQueueSubmitWithCircuitBreaker).mockResolvedValue({
      request_id: "fal-req-123",
    } as never);

    const res = await POST(
      makeRequest({
        roomId: MOCK_ROOM_ID,
        sourceSlot: 0,
        variantSlot: 0,
        aesthetic: "mid-century modern",
      })
    );

    expect(res.status).toBe(200);
    expect(evaluateInpaintQualityGate).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.qualityWarnings).toEqual([]);
    expect(json.degraded).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Non-creative — quality gate warns → degraded=true
  // -------------------------------------------------------------------------

  it("returns 200 with empty qualityWarnings regardless of gate output (#1262)", async () => {
    // The gate output is no longer surfaced — even a non-empty gate result
    // is silently dropped on the synchronous path.
    vi.mocked(getDailyUsage).mockResolvedValue(0);
    vi.mocked(evaluateInpaintQualityGate).mockResolvedValue([
      "prompt is vague — consider adding more specific style details",
    ]);
    vi.mocked(falQueueSubmitWithCircuitBreaker).mockResolvedValue({
      request_id: "fal-req-123",
    } as never);

    const res = await POST(
      makeRequest({
        roomId: MOCK_ROOM_ID,
        sourceSlot: 0,
        variantSlot: 0,
        aesthetic: "mid-century modern",
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.qualityWarnings).toEqual([]);
    expect(json.degraded).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Fal submission failure → 500
  // -------------------------------------------------------------------------

  it("returns 200 with the pre-allocated requestId when the background submit rejects (#1262)", async () => {
    // Fire-and-forget (#1262): the submit runs in a detached promise,
    // so its failure does NOT surface on the synchronous POST response.
    // The row pre-write happened before the submit was fired; the route
    // returns that row id. The background tick marks the row ERROR so
    // the poller's gone-recovery path hands over a terminal shape.
    vi.mocked(getDailyUsage).mockResolvedValue(0);
    vi.mocked(evaluateDailyQuota).mockReset();
    vi.mocked(evaluateDailyQuota).mockReturnValue({ allowed: true, used: 0, limit: 20, remaining: 20 });
    const authError = new Error("Auth error") as Error & { status: number };
    authError.status = 401;
    vi.mocked(falQueueSubmitWithCircuitBreaker).mockReset();
    vi.mocked(falQueueSubmitWithCircuitBreaker).mockRejectedValue(authError);

    const res = await POST(
      makeRequest({
        roomId: MOCK_ROOM_ID,
        sourceSlot: 0,
        variantSlot: 0,
        aesthetic: "mid-century modern",
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.requestId).toBe("string");
    expect(json.requestId.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Quota ledger (issue #1131)
  // -------------------------------------------------------------------------

  it("charges the ledger and never counts InpaintRequest rows", async () => {
    vi.mocked(getDailyUsage).mockResolvedValue(0);
    vi.mocked(falQueueSubmitWithCircuitBreaker).mockResolvedValue({ request_id: "fal-req-123" });

    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 0, variantSlot: 0 }));

    expect(res.status).toBe(200);
    // Issue #1111: the route now atomically CLAIMS via claimDailyQuota
    // before the paid provider call (mirrors the other four paid
    // surfaces — issue #1132). The post-submit recordDailyUsage upsert
    // is gone; the claim IS the charge.
    const { claimDailyQuota } = await import("@/lib/api-quota");
    expect(claimDailyQuota).toHaveBeenCalledWith(
      "inpaint",
      MOCK_USER_ID,
      20,
      1,
      expect.any(Date)
    );
    // The old derivation: usage counted from rows that cascade-delete.
    expect(prisma.inpaintRequest.count).not.toHaveBeenCalled();
  });

  it("does not charge the ledger when the quota gate blocks the request", async () => {
    // Issue #1111: the route now atomically CLAIMS via claimDailyQuota
    // before the paid provider call; the prior
    // getDailyUsage+evaluateDailyQuota read-only check is gone. Make
    // the claim return denied so the route takes the 429 path and
    // does not fire the provider call.
    const { claimDailyQuota } = await import("@/lib/api-quota");
    vi.mocked(claimDailyQuota).mockResolvedValueOnce({
      claimed: false,
      allowed: false,
      used: 20,
      limit: 20,
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    });

    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 0, variantSlot: 0 }));

    expect(res.status).toBe(429);
    expect(falQueueSubmitWithCircuitBreaker).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Synchronous provider (#1240 multi-instance fix)
  // -------------------------------------------------------------------------

  it("pre-writes the InpaintRequest row with a local UUID + status=IN_QUEUE (#1262)", async () => {
    // Issue #1262: the route no longer awaits the provider submit. It
    // pre-allocates a LOCAL UUID (`randomUUID()`) as the requestId so
    // it can write the row before returning, then fires the submit
    // in the background. The pre-write id is what the client polls,
    // so the row's primary key must NOT depend on the provider's id.
    vi.mocked(falQueueSubmitWithCircuitBreaker).mockResolvedValue({
      request_id: "dashscope-req-123",
    } as never);

    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 0, variantSlot: 0 }));

    expect(res.status).toBe(200);
    expect(prisma.inpaintRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "IN_QUEUE",
        }),
      }),
    );
    const createCall = vi.mocked(prisma.inpaintRequest.create).mock.calls[0]?.[0];
    const data = (createCall as { data: Record<string, unknown> }).data;
    // The id is a local UUID — NOT the provider's request id, because
    // the route returns BEFORE the provider responds.
    const id = data.id as string;
    expect(id).not.toBe("dashscope-req-123");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    // No resultUrl at pre-write time — the background tick fills it in.
    expect(data).not.toHaveProperty("resultUrl");
    // The response body carries the same local UUID.
    const json = await res.json();
    expect(json.requestId).toBe(id);
  });

  it("updates the row to status=COMPLETED + resultUrl when the background submit returns a synchronous result (#1262 + #1240)", async () => {
    // The multi-instance fix from #1240 still applies: the background
    // tick writes status=COMPLETED + resultUrl=<dashscope-url> when
    // the provider returns the synchronous result inline. The poller's
    // `decideInpaintPersistence` then short-circuits to `return-stored`
    // on every Vercel instance regardless of which lambda got the
    // first poll.
    const dashScopeUrl =
      "https://dashscope-result-sz.oss-accelerate.aliyuncs.com/abc.png";
    vi.mocked(falQueueSubmitWithCircuitBreaker).mockResolvedValue({
      request_id: "dashscope-req-123",
      result: {
        imageUrl: dashScopeUrl,
        width: 2048,
        height: 1536,
      },
    } as never);

    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 0, variantSlot: 0 }));

    expect(res.status).toBe(200);
    const json = await res.json();
    const requestId = json.requestId as string;
    expect(prisma.inpaintRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: requestId },
        data: expect.objectContaining({
          providerJobId: "dashscope-req-123",
          status: "COMPLETED",
          resultUrl: dashScopeUrl,
        }),
      }),
    );
  });

  it("updates the row to status=IN_PROGRESS (no resultUrl) when the background submit returns no synchronous result (#1262)", async () => {
    // Async providers (fal queue, Replicate) leave `result` undefined.
    // The background tick still writes the providerJobId + flips the
    // status off `IN_QUEUE` so the poller's gone-recovery path (#1202)
    // does not loop forever on a row that never had a job queued. We
    // bump it to IN_PROGRESS so the poller knows it is past submit.
    vi.mocked(falQueueSubmitWithCircuitBreaker).mockResolvedValue({
      request_id: "fal-req-123",
    } as never);

    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 0, variantSlot: 0 }));

    expect(res.status).toBe(200);
    const json = await res.json();
    const requestId = json.requestId as string;
    const updateCall = vi.mocked(prisma.inpaintRequest.update).mock.calls[0]?.[0];
    expect(updateCall).toBeDefined();
    const updateData = (updateCall as { data: Record<string, unknown> }).data;
    expect(updateData.providerJobId).toBe("fal-req-123");
    expect(updateData.status).toBe("IN_PROGRESS");
    expect(updateData).not.toHaveProperty("resultUrl");
    void requestId;
  });
});
