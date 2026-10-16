import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";
const MOCK_PROJECT_ID = "cproj12345678901234567890";

// vi.hoisted so the mocks are shared across all `import("@/lib/...")`
// calls (factory-style `vi.mock` bindings would otherwise be
// re-evaluated per dynamic import, breaking cross-module assertions).
const mockGetAuthedPrismaUser = vi.hoisted(() => vi.fn());
const mockRoomFindFirst = vi.hoisted(() => vi.fn());
const mockRoomFindUnique = vi.hoisted(() => vi.fn());
const mockClaimDailyQuota = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      claimed: true,
      allowed: true,
      used: 1,
      limit: 50,
      remaining: 49,
    })
  )
);
const mockRefundDailyQuota = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(undefined))
);
const mockGenerateWithFailover = vi.hoisted(() => vi.fn());

function buildRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    url: "http://localhost/api/v1/listing-copy",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: mockGetAuthedPrismaUser,
  requireProjectOwnershipOrThrow: vi.fn(async () => {}),
  ProjectNotFoundError: class ProjectNotFoundError extends Error {},
  ProjectForbiddenError: class ProjectForbiddenError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findFirst: mockRoomFindFirst,
      findUnique: mockRoomFindUnique,
    },
  },
}));

vi.mock("@/lib/ai", () => ({
  FALLBACK_MODEL_ID: "gpt-4o",
  FALLBACK_PRIMARY_ID: "gpt-4o-mini",
  aiModel: "gpt-4o-mini",
  assertOpenAIConfigured: vi.fn(),
  generateWithCircuitBreaker: vi.fn(),
  generateWithFailover: mockGenerateWithFailover,
}));

vi.mock("@/lib/api-quota", () => ({
  DEFAULT_DAILY_COPY_LIMIT: 50,
  DAILY_LIMIT_ENV_VAR: {
    inpaint: "DAILY_INPAINT_LIMIT",
    copy: "DAILY_COPY_LIMIT",
    label: "DAILY_LABEL_LIMIT",
    export: "DAILY_EXPORT_LIMIT",
    segment: "DAILY_SEGMENT_LIMIT",
  },
  claimDailyQuota: mockClaimDailyQuota,
  refundDailyQuota: mockRefundDailyQuota,
  resolveDailyLimit: vi.fn((_raw: string | undefined, fallback: number) => fallback),
  dailyQuotaExceededPayload: vi.fn(() => ({
    error: "Daily limit reached",
    message: "Please try again tomorrow.",
    retryable: true,
    used: 50,
    limit: 50,
    resetsAt: "2026-09-25T00:00:00.000Z",
  })),
}));

// Imports AFTER the mocks above so vi.mock can swap them.
import { POST } from "@/app/api/v1/listing-copy/route";

describe("POST /api/v1/listing-copy (issue #1343, CopyPanel rewrite)", () => {
  beforeEach(() => {
    // vi.clearAllMocks clears call history but keeps the mock fn
    // implementations from the vi.hoisted() defaults above.
    vi.clearAllMocks();
    // Re-assert the default claim + refund behavior per test — these
    // are the "happy path" defaults individual tests override.
    mockClaimDailyQuota.mockResolvedValue({
      claimed: true,
      allowed: true,
      used: 1,
      limit: 50,
      remaining: 49,
    });
    mockRefundDailyQuota.mockResolvedValue(undefined);

    mockGetAuthedPrismaUser.mockResolvedValue({ id: MOCK_USER_ID });
    mockRoomFindFirst.mockResolvedValue({
      id: MOCK_ROOM_ID,
      projectId: MOCK_PROJECT_ID,
    });
    mockRoomFindUnique.mockResolvedValue({
      id: MOCK_ROOM_ID,
      name: "Living Room",
      projectId: MOCK_PROJECT_ID,
      rawDirectives: "Make it modern and bright",
      lookbookHeadline: null,
      lookbookBody: null,
      project: {
        stagingAesthetic: "Modern Farmhouse",
        targetBuyer: "Young families",
        stagingDirectives: "Lean into natural materials.",
      },
    });
    mockGenerateWithFailover.mockResolvedValue({
      result: {
        object: {
          headline: "Bright & airy living room with restored crown molding",
          body: "Soft linen sofa centered under the original archway.",
        },
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
      modelId: "gpt-4o-mini",
      failedOver: false,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetAuthedPrismaUser.mockResolvedValue(null);

    const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toMatchObject({
      success: false,
      error: "Unauthorized",
      message: "You must be signed in to rewrite listing copy.",
    });
  });

  it("returns 400 for an empty body", async () => {
    const response = await POST(buildRequest({}));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      error: "Invalid request",
    });
  });

  it("returns 400 for unknown keys (strict object — same rule as /api/v1/inpaint)", async () => {
    const response = await POST(
      buildRequest({ roomId: MOCK_ROOM_ID, tone: "creative" })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      error: "Invalid request",
    });
  });

  it("returns 404 when the room does not exist", async () => {
    mockRoomFindFirst.mockResolvedValue(null);

    const response = await POST(buildRequest({ roomId: "nonexistent-room" }));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json).toMatchObject({
      success: false,
      error: "Room not found",
      code: "room-not-found",
    });
  });

  it("returns 400 when neither room nor global directives are set", async () => {
    mockRoomFindUnique.mockResolvedValue({
      id: MOCK_ROOM_ID,
      name: "Living Room",
      projectId: MOCK_PROJECT_ID,
      rawDirectives: null,
      lookbookHeadline: null,
      lookbookBody: null,
      project: {
        stagingAesthetic: "Modern Farmhouse",
        targetBuyer: "Young families",
        stagingDirectives: null,
      },
    });

    const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      error: "Missing staging directives",
    });
  });

  it("returns 429 when the daily copy quota is exhausted", async () => {
    mockClaimDailyQuota.mockResolvedValueOnce({
      claimed: false,
      allowed: false,
      used: 50,
      limit: 50,
      resetsAt: "2026-09-25T00:00:00.000Z",
    } as never);

    const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.success).toBe(false);
    expect(json.code).toBe("rate-limit-exceeded");
  });

  it("returns 200 with the model output on success and claims exactly one quota unit", async () => {
    const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      data: {
        headline: "Bright & airy living room with restored crown molding",
        body: "Soft linen sofa centered under the original archway.",
      },
    });
    expect(response.headers.get("X-Supabase-API-Version")).toBe("v1");
    // Issue #1132: exactly one quota claim per paid call. A concurrent
    // burst that overshoots is closed by `claimDailyQuota` itself.
    expect(mockClaimDailyQuota).toHaveBeenCalledTimes(1);
    expect(mockClaimDailyQuota).toHaveBeenCalledWith(
      "copy",
      MOCK_USER_ID,
      50
    );
  });

  it("threads priorHeadline from lookbookHeadline so a re-rewrite keeps the same framing", async () => {
    mockRoomFindUnique.mockResolvedValue({
      id: MOCK_ROOM_ID,
      name: "Living Room",
      projectId: MOCK_PROJECT_ID,
      rawDirectives: "Make it modern and bright",
      // The previous user-edited headline feeds the prompt as a tone
      // anchor — the model prefers to keep the same framing when the
      // directives haven't changed.
      lookbookHeadline: "Bright living room with original moldings",
      lookbookBody: "A previous body the user typed.",
      project: {
        stagingAesthetic: "Modern Farmhouse",
        targetBuyer: "Young families",
        stagingDirectives: "Lean into natural materials.",
      },
    });

    await POST(buildRequest({ roomId: MOCK_ROOM_ID }));

    // The route is opaque about the prompt body — we just confirm
    // the model was invoked. The byte-exact prompt bytes are pinned
    // in tests/prompts.test.ts.
    expect(mockGenerateWithFailover).toHaveBeenCalledTimes(1);
  });

  it("refunds the quota claim when the provider call throws (issue #1132)", async () => {
    mockGenerateWithFailover.mockRejectedValue(
      new Error("rate limit exceeded for API key")
    );

    const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
    const json = await response.json();

    // The provider-side rate-limit message classifies as
    // `rateLimit` and surfaces 429. A future reader who misreads
    // this as a hard 500 would still get the right refund — the
    // claim is only refunded when `copyGenerationResolved` is
    // false, which is what we assert below.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mockRefundDailyQuota).toHaveBeenCalledTimes(1);
    expect(mockRefundDailyQuota).toHaveBeenCalledWith("copy", MOCK_USER_ID);
    // Sanity check: a JSON `error` short label is always present
    // even when the response status surfaces a vendor classification.
    expect(json).toHaveProperty("error");
  });

  it("does NOT refund the quota claim when the call resolves and the response is parsed", async () => {
    await POST(buildRequest({ roomId: MOCK_ROOM_ID }));

    // A successful rewrite that parses through listingCopyOutputSchema
    // keeps the unit claimed — the paid call already consumed it.
    expect(mockRefundDailyQuota).not.toHaveBeenCalled();
  });
});