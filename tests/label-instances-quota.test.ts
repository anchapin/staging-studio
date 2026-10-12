import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/label-instances/route";
import {
  claimDailyQuota,
  refundDailyQuota,
  type QuotaClaim,
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
    url: "http://localhost/api/label-instances",
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
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
    room: { findFirst: vi.fn() },
  },
}));

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@/lib/api-quota", () => ({
  claimDailyQuota: vi.fn(),
  refundDailyQuota: vi.fn(),
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
    imageUrl: "https://example.supabase.co/room.jpg",
  };
}

describe("POST /api/label-instances", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    vi.mocked(claimDailyQuota).mockResolvedValue({
      claimed: true,
      allowed: true,
      used: 1,
      limit: 50,
      remaining: 49,
    } as QuotaClaim);
    vi.mocked(refundDailyQuota).mockResolvedValue(undefined);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: MOCK_ROOM_ID } as never);
    vi.mocked(assertOpenAIConfigured).mockReturnValue(undefined);
    vi.mocked(getCachedVisionLabels).mockResolvedValue([]);
    vi.mocked(upsertVisionLabels).mockResolvedValue(undefined);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const response = await POST(buildNextRequest(validBody()));

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error.code).toBe("unauthorized");
  });

  it("returns 429 when daily label quota exceeded", async () => {
    vi.mocked(claimDailyQuota).mockResolvedValue({
      claimed: false,
      allowed: false,
      used: 50,
      limit: 50,
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    } as QuotaClaim);

    const response = await POST(buildNextRequest(validBody()));

    expect(response.status).toBe(429);
    const json = await response.json();
    expect(json.error.code).toBe("rate-limit-exceeded");
  });

  it("gates the batch by crop count and rejects a batch that would straddle the limit (issue #1144)", async () => {
    // Issue #1132: the route claims the batch atomically; a straddling
    // batch is denied by the conditional increment (modeled here by the
    // claim returning the denied decision for used=48 + 5 > 50).
    vi.mocked(claimDailyQuota).mockResolvedValue({
      claimed: false,
      allowed: false,
      used: 48,
      limit: 50,
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    } as QuotaClaim);
    const body = validBody();
    body.crops = [0, 1, 2, 3, 4].map((i) => ({
      instanceIndex: i,
      cropDataUrl:
        "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==",
    }));

    const response = await POST(buildNextRequest(body));

    // 48 used + 5 crops > 50 limit: the whole batch is refused
    expect(response.status).toBe(429);
    const json = await response.json();
    expect(json.error.code).toBe("rate-limit-exceeded");
    expect(claimDailyQuota).toHaveBeenCalledWith("label", MOCK_USER_ID, 50, 5);
    expect(refundDailyQuota).not.toHaveBeenCalled();
  });

  it("does not consume quota on cache hit", async () => {
    vi.mocked(getCachedVisionLabels).mockResolvedValue([
      { id: "vl1", imageUrlHash: "hash123", concept: "furniture", instanceIndex: 0, label: "accent chair", score: null, userId: "user1", roomId: null, createdAt: new Date() },
    ]);

    const response = await POST(buildNextRequest(validBody()));

    expect(response.status).toBe(200);
    expect(claimDailyQuota).not.toHaveBeenCalled();
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
    expect(claimDailyQuota).toHaveBeenCalledTimes(1);
    expect(claimDailyQuota).toHaveBeenCalledWith("label", MOCK_USER_ID, 50, 1);
  });

  it("charges one quota unit per vision crop (issue #1144)", async () => {
    vi.mocked(generateWithCircuitBreaker).mockImplementation(async (fn: () => Promise<unknown>) => {
      return fn();
    });
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        labels: [0, 1, 2].map((i) => ({ instanceIndex: i, label: `item ${i}` })),
      },
    } as never);
    const body = validBody();
    body.crops = [0, 1, 2].map((i) => ({
      instanceIndex: i,
      cropDataUrl:
        "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==",
    }));

    const response = await POST(buildNextRequest(body));

    expect(response.status).toBe(200);
    expect(claimDailyQuota).toHaveBeenCalledWith("label", MOCK_USER_ID, 50, 3);
  });

  it("refunds the claimed quota when the API call fails (issue #1132)", async () => {
    // With the atomic-claim pattern (issue #1132) the units ARE held
    // before the call; the route must refund them when the call throws,
    // so a failed attempt still costs nothing against the daily cap.
    vi.mocked(generateWithCircuitBreaker).mockImplementation(async (fn: () => Promise<unknown>) => {
      return fn();
    });
    vi.mocked(generateObject).mockRejectedValue(new Error("OpenAI error"));

    const response = await POST(buildNextRequest(validBody()));

    expect(response.status).toBe(500);
    expect(claimDailyQuota).toHaveBeenCalledTimes(1);
    expect(refundDailyQuota).toHaveBeenCalledWith("label", MOCK_USER_ID, 1);
  });
});
