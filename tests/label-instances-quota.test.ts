import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/label-instances/route";
import {
  getDailyUsage,
  recordDailyUsage,
  evaluateDailyQuota,
  type QuotaDecision,
} from "@/lib/api-quota";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getCachedVisionLabels, upsertVisionLabels } from "@/lib/vision-labels";
import { generateObject } from "ai";
import { generateWithCircuitBreaker, assertOpenAIConfigured } from "@/lib/ai";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";

const mockUser = { id: MOCK_USER_ID, email: "test@example.com" };

// Build the NextRequest-like object that returns parsed JSON from .json()
function buildNextRequest(body: unknown) {
  return {
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: { findFirst: vi.fn() },
  },
}));

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@/lib/api-quota", () => ({
  getDailyUsage: vi.fn(),
  recordDailyUsage: vi.fn(),
  evaluateDailyQuota: vi.fn(),
  resolveDailyLimit: vi.fn(() => 50),
  DEFAULT_DAILY_LABEL_LIMIT: 50,
  DAILY_LIMIT_ENV_VAR: { label: "DAILY_LABEL_LIMIT" },
  dailyQuotaExceededPayload: vi.fn(() => ({
    error: "Daily limit reached",
    message: "Please try again tomorrow.",
    retryable: true,
    used: 50,
    limit: 50,
    resetsAt: new Date(Date.now() + 86400000).toISOString(),
  })),
}));

vi.mock("@/lib/vision-labels", () => ({
  getCachedVisionLabels: vi.fn(),
  upsertVisionLabels: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({
  aiModel: "gpt-4o-mini",
  assertOpenAIConfigured: vi.fn(),
  generateWithCircuitBreaker: vi.fn(),
}));

function validBody() {
  return {
    roomId: MOCK_ROOM_ID,
    concept: "accent chair",
    crops: [
      {
        instanceIndex: 0,
        // Must be >= 100 chars (min length in schema)
        cropDataUrl:
          "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==",
      },
    ],
    imageUrl: "https://example.com/room.jpg",
  };
}

describe("POST /api/label-instances", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    vi.mocked(getDailyUsage).mockResolvedValue(0);
    vi.mocked(evaluateDailyQuota).mockReturnValue({
      allowed: true,
      used: 0,
      limit: 50,
      remaining: 50,
    } as QuotaDecision);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: MOCK_ROOM_ID } as never);
    vi.mocked(assertOpenAIConfigured).mockReturnValue(undefined);
    vi.mocked(getCachedVisionLabels).mockResolvedValue([]);
    vi.mocked(upsertVisionLabels).mockResolvedValue(undefined);
    vi.mocked(recordDailyUsage).mockResolvedValue(0 as never);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const response = await POST(buildNextRequest(validBody()));

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 429 when daily label quota exceeded", async () => {
    vi.mocked(evaluateDailyQuota).mockReturnValue({
      allowed: false,
      used: 50,
      limit: 50,
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    } as never);

    const response = await POST(buildNextRequest(validBody()));

    expect(response.status).toBe(429);
    const json = await response.json();
    expect(json.error).toBe("Daily limit reached");
    expect(json.retryable).toBe(true);
  });

  it("does not consume quota on cache hit", async () => {
    vi.mocked(getCachedVisionLabels).mockResolvedValue([
      { id: "vl1", imageUrlHash: "hash123", concept: "furniture", instanceIndex: 0, label: "accent chair", score: null, userId: "user1", roomId: null, createdAt: new Date() },
    ]);

    const response = await POST(buildNextRequest(validBody()));

    expect(response.status).toBe(200);
    expect(recordDailyUsage).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("consumes quota after successful API call", async () => {
    // Mock generateWithCircuitBreaker to call the inner function
    vi.mocked(generateWithCircuitBreaker).mockImplementation(async (fn: () => Promise<unknown>) => {
      return fn();
    });
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        labels: [{ instanceIndex: 0, label: "accent chair" }],
      },
    } as never);

    const response = await POST(buildNextRequest(validBody()));

    expect(response.status).toBe(200);
    expect(recordDailyUsage).toHaveBeenCalledTimes(1);
    expect(recordDailyUsage).toHaveBeenCalledWith("label", MOCK_USER_ID);
  });

  it("does not consume quota when API call fails", async () => {
    // This is the key test: if quota were consumed BEFORE the API call,
    // recordDailyUsage would still be called even when the API call fails.
    // With the correct pattern (consume AFTER success), recordDailyUsage
    // should NOT be called when the API call throws.
    vi.mocked(generateWithCircuitBreaker).mockImplementation(async (fn: () => Promise<unknown>) => {
      return fn();
    });
    vi.mocked(generateObject).mockRejectedValue(new Error("OpenAI error"));

    const response = await POST(buildNextRequest(validBody()));

    expect(response.status).toBe(500);
    expect(recordDailyUsage).not.toHaveBeenCalled();
  });
});
