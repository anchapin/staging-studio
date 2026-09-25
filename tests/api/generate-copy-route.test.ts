import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/generate-copy/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { saveRoomCopy } from "@/app/actions/room";
import { generateWithCircuitBreaker } from "@/lib/ai";

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
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findFirst: vi.fn(),
    },
    dailyApiUsage: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai", () => ({
  aiModel: "gpt-4o-mini",
  assertOpenAIConfigured: vi.fn(),
  generateWithCircuitBreaker: vi.fn(),
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
  getDailyUsage: vi.fn(() => Promise.resolve(0)),
  evaluateDailyQuota: vi.fn(() => ({
    allowed: true,
    used: 0,
    limit: 50,
    remaining: 50,
  })),
  resolveDailyLimit: vi.fn((_raw: string | undefined, fallback: number) => fallback),
  recordDailyUsage: vi.fn(() => Promise.resolve(1)),
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
    });
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
    const { evaluateDailyQuota } = vi.mocked(await import("@/lib/api-quota"));
    evaluateDailyQuota.mockReturnValueOnce({
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
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
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
        stagingDirectives: null,
        userId: MOCK_USER_ID,
        clientName: null,
        buyerDemographics: null,
        stagingAesthetic: null,
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
    } as Awaited<ReturnType<typeof prisma.room.findFirst>>);

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

    vi.mocked(generateWithCircuitBreaker).mockResolvedValue({
      object: mockCopy,
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
    vi.mocked(saveRoomCopy).mockResolvedValue({ success: true });

    const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      data: mockCopy,
    });
    expect(json.data.observedChallenge).toBe("Limited natural light");
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

    vi.mocked(generateWithCircuitBreaker).mockResolvedValue({
      object: mockCopy,
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
    vi.mocked(saveRoomCopy).mockResolvedValue({ success: false, error: "DB error" });

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
