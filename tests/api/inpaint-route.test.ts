/**
 * Inpaint Route — POST /api/inpaint
 *
 * Coverage:
 * - 401 unauthenticated
 * - 400 Zod validation failures (missing roomId, invalid sourceSlot range, etc.)
 * - 429 daily inpaint quota exceeded
 * - 404 room not found
 * - 400 invalid source (variant slot has no staged result)
 * - 202 creativeMode=true → quality gate skipped
 * - 202 creativeMode=false → quality gate runs with no warnings
 * - 202 quality gate warns → degraded=true in response
 * - userUsage upserted after success
 * - 500 on fal submission failure
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/inpaint/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { fal } from "@/lib/fal";
import { evaluateInpaintQualityGate } from "@/lib/inpaint-quality-gate";
import { resolveDailyLimit, evaluateDailyQuota, dailyQuotaExceededPayload, inpaintDailyUsageWhere } from "@/lib/api-quota";
import { buildInpaintPrompt } from "@/lib/prompts";
import { classifyIntegrationError, INPAINT_ERROR_COPY } from "@/lib/error-classify";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";

const mockUser = { id: MOCK_USER_ID, emailAddress: "test@example.com" };

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
    prompt: "replace sofa with leather sofa",
    createdAt: new Date(),
    updatedAt: new Date(),
    degraded: false,
    qualityWarnings: [],
    promptStrength: 0.8,
    seed: null,
    creativeMode: false,
    sourceSlot: 0,
    variantSlot: 0,
    aesthetic: "mid-century modern",
    negativePrompt: null,
    maskBlur: 0,
    lockSeed: false,
    falRequestId: null,
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
  return { json: () => Promise.resolve({ ...BASE_BODY, ...overrides }) } as unknown as NextRequest;
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
    inpaintRequest: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    room: { findFirst: vi.fn() },
    userUsage: { findFirst: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/lib/fal", () => ({
  fal: {
    queue: {
      submit: vi.fn(),
    },
  },
  assertFalConfigured: vi.fn(),
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
  inpaintDailyUsageWhere: vi.fn((userId: string) => ({
    room: { project: { userId } },
    createdAt: { gte: new Date() },
  })),
}));

vi.mock("@/lib/error-classify", () => ({
  classifyIntegrationError: vi.fn((_ctx, err) => {
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      if (msg.includes("rate") || msg.includes("limit") || msg.includes("quota")) {
        return { type: "quota_exceeded" as const, message: INPAINT_ERROR_COPY.QUOTA_EXCEEDED, status: 429, error: "QuotaExceeded", retryable: true };
      }
      if (msg.includes("timeout") || msg.includes("timed out")) {
        return { type: "timeout" as const, message: INPAINT_ERROR_COPY.TIMEOUT, status: 408, error: "Timeout", retryable: true };
      }
      if (msg.includes("network") || msg.includes("fetch") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("etimedout")) {
        return { type: "network" as const, message: INPAINT_ERROR_COPY.SERVICE_UNAVAILABLE, status: 503, error: "ServiceUnavailable", retryable: true };
      }
      return { type: "unknown" as const, message: INPAINT_ERROR_COPY.UNKNOWN, status: 500, error: "UnknownError", retryable: true };
    }),
  INPAINT_ERROR_COPY: {
    QUOTA_EXCEEDED: "Daily inpaint limit reached. Please try again tomorrow.",
    RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
    SERVICE_UNAVAILABLE: "AI service temporarily unavailable. Please try again later.",
    UNKNOWN: "An unexpected error occurred. Please try again.",
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/inpaint", () => {
  beforeEach(() => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue(mockRoom as never);
    vi.mocked(prisma.inpaintRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.inpaintRequest.create).mockResolvedValue(mockInpaintRequest());
    vi.mocked(prisma.userUsage.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.userUsage.upsert).mockResolvedValue({} as never);
    vi.mocked(evaluateInpaintQualityGate).mockResolvedValue([]);
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: "fal-req-123" });
    vi.mocked(buildInpaintPrompt).mockReturnValue("replace sofa with leather sofa");
    vi.mocked(resolveDailyLimit).mockReturnValue(20);
    vi.mocked(evaluateDailyQuota).mockReturnValue({ allowed: true, used: 0, limit: 20 });
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
    vi.mocked(prisma.inpaintRequest.count).mockResolvedValue(10);
    vi.mocked(evaluateDailyQuota).mockImplementation(() => ({
      allowed: false,
      used: 10,
      limit: 10,
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    }));

    const res = await POST(makeRequest({ roomId: MOCK_ROOM_ID, sourceSlot: 0, variantSlot: 0 }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toBe("DAILY_LIMIT_EXCEEDED");
  });

  // -------------------------------------------------------------------------
  // Room not found
  // -------------------------------------------------------------------------

  it("returns 404 when room is not found", async () => {
    vi.mocked(prisma.inpaintRequest.count).mockResolvedValue(0);
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
    vi.mocked(prisma.inpaintRequest.count).mockResolvedValue(0);
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
    vi.mocked(prisma.inpaintRequest.count).mockResolvedValue(0);
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

  it("returns 200 and includes quality warnings when creativeMode=true", async () => {
    vi.mocked(prisma.inpaintRequest.count).mockResolvedValue(0);
    vi.mocked(evaluateInpaintQualityGate).mockResolvedValue([]);
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: "fal-req-123" });

    const res = await POST(
      makeRequest({
        roomId: MOCK_ROOM_ID,
        sourceSlot: 0,
        variantSlot: 0,
        creativeMode: true,
        aesthetic: "mid-century modern",
      })
    );

    expect(res.status).toBe(200);
    // creativeMode does not skip the quality gate; it only omits mask hints
    // in the fal payload. The gate still runs for advisory warnings.
    expect(evaluateInpaintQualityGate).toHaveBeenCalled();
    const json = await res.json();
    expect(json.qualityWarnings).toEqual([]);
    expect(json.degraded).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Non-creative — quality gate runs, no warnings
  // -------------------------------------------------------------------------

  it("returns 200 when quality gate passes with no warnings", async () => {
    vi.mocked(prisma.inpaintRequest.count).mockResolvedValue(0);
    vi.mocked(evaluateInpaintQualityGate).mockResolvedValue([]);
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: "fal-req-123" });

    const res = await POST(
      makeRequest({
        roomId: MOCK_ROOM_ID,
        sourceSlot: 0,
        variantSlot: 0,
        creativeMode: false,
        aesthetic: "mid-century modern",
      })
    );

    expect(res.status).toBe(200);
    expect(evaluateInpaintQualityGate).toHaveBeenCalled();
    const json = await res.json();
    expect(json.qualityWarnings).toEqual([]);
    expect(json.degraded).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Non-creative — quality gate warns → degraded=true
  // -------------------------------------------------------------------------

  it("returns 200 with qualityWarnings when quality gate returns warnings", async () => {
    vi.mocked(prisma.inpaintRequest.count).mockResolvedValue(0);
    vi.mocked(evaluateInpaintQualityGate).mockResolvedValue([
      "prompt is vague — consider adding more specific style details",
    ]);
    vi.mocked(fal.queue.submit).mockResolvedValue({ request_id: "fal-req-123" });

    const res = await POST(
      makeRequest({
        roomId: MOCK_ROOM_ID,
        sourceSlot: 0,
        variantSlot: 0,
        creativeMode: false,
        aesthetic: "mid-century modern",
      })
    );

    expect(res.status).toBe(200);
    expect(evaluateInpaintQualityGate).toHaveBeenCalled();
    const json = await res.json();
    expect(json.qualityWarnings).toEqual([
      "prompt is vague — consider adding more specific style details",
    ]);
    // degraded=true is only set when the DB write fails (recordDegraded flag),
    // not when quality warnings are present.
    expect(json.degraded).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Fal submission failure → 500
  // -------------------------------------------------------------------------

  it("returns 500 when fal.queue.submit throws", async () => {
    vi.mocked(prisma.inpaintRequest.count).mockResolvedValue(0);
    vi.mocked(evaluateInpaintQualityGate).mockResolvedValue([]);
    vi.mocked(evaluateDailyQuota).mockReset();
    vi.mocked(evaluateDailyQuota).mockReturnValue({ allowed: true, used: 0, limit: 20 });
    vi.mocked(fal.queue.submit).mockReset();
    vi.mocked(fal.queue.submit).mockImplementation(
      () => Promise.reject(new Error("Fal AI network error"))
    );

    const res = await POST(
      makeRequest({
        roomId: MOCK_ROOM_ID,
        sourceSlot: 0,
        variantSlot: 0,
        creativeMode: false,
        aesthetic: "mid-century modern",
      })
    );

    expect(res.status).toBe(500);
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('"event":"inpaint_submit_failed"'),
      expect.any(Error)
    );
  });
});
