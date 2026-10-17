import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/generate-copy/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { saveRoomCopy } from "@/app/actions/room";
import { generateWithCircuitBreaker, generateWithFailover } from "@/lib/ai";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";
const MOCK_PROJECT_ID = "cproj12345678901234567890";

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

function buildRequest(body: unknown): NextRequest {
  // Issue #1116: POST is wrapped in withRequestLogging, so the double
  // must carry the header/url surface the wrapper reads.
  return {
    method: "POST",
    url: "http://localhost/api/generate-copy",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
  requireProjectOwnershipOrThrow: vi.fn(async () => {}),
  ProjectNotFoundError: class ProjectNotFoundError extends Error {},
  ProjectForbiddenError: class ProjectForbiddenError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    dailyApiUsage: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai", () => ({
  FALLBACK_MODEL_ID: "gpt-4o",
  FALLBACK_PRIMARY_ID: "gpt-4o-mini",
  aiModel: "gpt-4o-mini",
  assertOpenAIConfigured: vi.fn(),
  generateWithCircuitBreaker: vi.fn(),
  generateWithFailover: vi.fn(),
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
  claimDailyQuota: vi.fn(() =>
    Promise.resolve({
      claimed: true,
      allowed: true,
      used: 1,
      limit: 50,
      remaining: 49,
    })
  ),
  refundDailyQuota: vi.fn(() => Promise.resolve(undefined)),
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

vi.mock("@/app/actions/room", () => ({
  saveRoomCopy: vi.fn(),
}));

describe("POST /api/generate-copy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
      id: MOCK_ROOM_ID,
      projectId: MOCK_PROJECT_ID,
    } as any);
    vi.mocked(prisma.room.findUnique).mockResolvedValue({
      id: MOCK_ROOM_ID,
      name: "Living Room",
      projectId: MOCK_PROJECT_ID,
      beforeImageUrl: null,
      beforeImageUrl2: null,
      afterImageUrl: null,
      afterImageUrl2: null,
      selectedVariantIndex: 0,
      rawDirectives: "Make it modern and bright",
      observedChallenge: null,
      recommendation: null,
      buyerPsychology: null,
      checklistItems: null,
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      project: {
        id: MOCK_PROJECT_ID,
        name: "Test Project",
        stagingAesthetic: null,
        targetBuyer: null,
        stagingDirectives: null,
        buyerDemographics: null,
        userId: MOCK_USER_ID,
        clientName: null,
        stagingPackage: null,
        roiSalesPricePremium: null,
        roiTransactionVelocity: null,
        roiInvestmentTier: null,
        clientSignature: null,
        clientSignatureStatus: "Pending",
        clientSignatureTimestamp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as any);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toMatchObject({
      success: false,
      error: "Unauthorized",
      message: "You must be signed in to generate copy.",
    });
  });

  it("returns 429 when daily quota exceeded", async () => {
    const { claimDailyQuota } = vi.mocked(await import("@/lib/api-quota"));
    claimDailyQuota.mockResolvedValueOnce({
      claimed: false,
      allowed: false,
      used: 50,
      limit: 50,
      resetsAt: "2026-09-25T00:00:00.000Z",
    });

    const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.success).toBe(false);
    expect(json.error).toBe("Daily limit reached");
  });

  it("returns 404 when room not found", async () => {
    vi.mocked(prisma.room.findFirst).mockResolvedValue(null);

    const response = await POST(buildRequest({ roomId: "nonexistent-room" }));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json).toMatchObject({
      success: false,
      error: "Room not found",
    });
  });

  it("returns 400 when room has no directives", async () => {
    const mockRoomForFindFirst: any = {
      id: MOCK_ROOM_ID,
      projectId: MOCK_PROJECT_ID,
    };
    const mockRoomForFindUnique: any = {
      id: MOCK_ROOM_ID,
      name: "Living Room",
      projectId: MOCK_PROJECT_ID,
      beforeImageUrl: null,
      beforeImageUrl2: null,
      afterImageUrl: null,
      afterImageUrl2: null,
      selectedVariantIndex: 0,
      rawDirectives: null,
      observedChallenge: null,
      recommendation: null,
      buyerPsychology: null,
      checklistItems: null,
      sortOrder: 0,
      createdAt: new Date(),
      project: {
        id: MOCK_PROJECT_ID,
        name: "Test Project",
        stagingAesthetic: null,
        targetBuyer: null,
        stagingDirectives: null,
        buyerDemographics: null,
        userId: MOCK_USER_ID,
        clientName: null,
        stagingPackage: null,
        roiSalesPricePremium: null,
        roiTransactionVelocity: null,
        roiInvestmentTier: null,
        clientSignature: null,
        clientSignatureStatus: "Pending",
        clientSignatureTimestamp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    vi.mocked(prisma.room.findFirst).mockResolvedValue(mockRoomForFindFirst as any);
    vi.mocked(prisma.room.findUnique).mockResolvedValue(mockRoomForFindUnique as any);

    const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      error: "Missing staging directives",
    });
  });

  it("returns generated copy on success", async () => {
    const mockCopy = {
      observedChallenge: "Limited natural light",
      recommendation: "Add layered lighting with floor and table lamps",
      buyerPsychology: "Buyers want a warm, inviting space",
      checklist: [
        { item: "Add floor lamp near window", completed: false, notes: "" },
        { item: "Use light-colored curtains", completed: false, notes: "" },
      ],
    };

    vi.mocked(generateWithFailover).mockResolvedValue({
      result: {
        object: mockCopy,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
      modelId: "gpt-4o-mini",
      failedOver: false,
    });
    vi.mocked(saveRoomCopy).mockResolvedValue({ success: true });
    vi.mocked(generateWithCircuitBreaker).mockResolvedValue({
      object: { buyer_aligned: null, checklist_actionable: null, aesthetic_consistent: null, qualityWarnings: [] },
    });
    const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      data: mockCopy,
    });
    expect(json.data.observedChallenge).toBe("Limited natural light");
    // Issue #1224/#1132: exactly one quota claim per generation,
    // whatever model produced it (the claim is atomic and pre-call; the
    // charge lands only via the claim itself).
    const { claimDailyQuota } = await import("@/lib/api-quota");
    expect(claimDailyQuota).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when copy is generated but save fails", async () => {
    const mockCopy = {
      observedChallenge: "Limited natural light",
      recommendation: "Add layered lighting",
      buyerPsychology: "Buyers want warmth",
      checklist: [
        { item: "Add floor lamp", completed: false, notes: "" },
      ],
    };

    vi.mocked(generateWithFailover).mockResolvedValue({
      result: {
        object: mockCopy,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
      modelId: "gpt-4o",
      failedOver: true,
    });
    vi.mocked(saveRoomCopy).mockResolvedValue({ success: false, error: "DB error" });
    vi.mocked(generateWithCircuitBreaker).mockResolvedValue({
      object: { buyer_aligned: null, checklist_actionable: null, aesthetic_consistent: null, qualityWarnings: [] },
    });
    const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toMatchObject({
      success: false,
      error: "save_failed",
      retryable: true,
      copy: mockCopy,
    });
  });

  it("returns 400 for invalid request body", async () => {
    const response = await POST(buildRequest({}));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      error: "Invalid request",
    });
  });
});
