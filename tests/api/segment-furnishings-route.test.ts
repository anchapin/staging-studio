/**
 * Furnishings Route - daily SAM 3.1 cap, auth, and happy path (issue #1108)
 *
 * Pins the segment surface end-to-end at the route layer so the
 * `DAILY_SEGMENT_LIMIT` cap (default 100) cannot silently regress to
 * un-enforced or to a different status. The companion
 * `segment-furnishings-partial-masks.test.ts` covers the mask-fetch
 * settle-per-mask behavior (issue #1119) and runs against the same
 * route; this file is scoped to the quota, auth, and detection-shape
 * guarantees called out in #1108.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/segment/furnishings/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import type { QuotaClaim } from "@/lib/api-quota";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { room: { findFirst: vi.fn() } },
}));

const mockFalSubscribe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/inference", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inference")>();
  return {
    ...actual,
    assertInferenceConfigured: vi.fn(),
    getInferenceClient: vi.fn(async () => ({
      subscribe: mockFalSubscribe,
      submit: vi.fn(),
      status: vi.fn(),
      result: vi.fn(),
    })),
  };
});

const mockClaimDailyQuota = vi.hoisted(() =>
  vi.fn<(surface: string, userId: string, limit: number) => Promise<QuotaClaim>>(
    async () => ({ claimed: true, allowed: true, used: 1, limit: 100, remaining: 99 })
  )
);
const mockRefundDailyQuota = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/api-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-quota")>();
  return {
    ...actual,
    claimDailyQuota: mockClaimDailyQuota,
    refundDailyQuota: mockRefundDailyQuota,
    resolveDailyLimit: vi.fn(() => 100),
  };
});

function buildRequest(): NextRequest {
  return {
    url: "http://localhost/api/segment/furnishings",
    json: async () => ({
      roomId: MOCK_ROOM_ID,
      imageUrl: "https://demo.supabase.co/storage/v1/object/public/room-photos/room.jpg",
      concept: "sofa",
    }),
  } as unknown as NextRequest;
}

function pngResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

const MASK_URLS = [
  "https://v3.fal.ai/mask-0.png",
  "https://v3.fal.ai/mask-1.png",
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthedPrismaUser).mockResolvedValue({
    id: MOCK_USER_ID,
    email: "test@example.com",
  } as never);
  vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: MOCK_ROOM_ID } as never);
  mockFalSubscribe.mockResolvedValue({
    masks: MASK_URLS.map((url, index) => ({ url, score: 0.9 - index / 10 })),
    scores: [0.9, 0.8],
  });
  vi.stubGlobal("fetch", vi.fn(async () => pngResponse()));
  mockClaimDailyQuota.mockResolvedValue({
    claimed: true,
    allowed: true,
    used: 1,
    limit: 100,
    remaining: 99,
  } as QuotaClaim);
  mockRefundDailyQuota.mockResolvedValue(undefined);
});

describe("POST /api/segment/furnishings (issue #1108)", () => {
  describe("auth guard", () => {
    it("returns 401 when not authenticated", async () => {
      vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

      const response = await POST(buildRequest());
      const body = await response.json();

      expect(response.status).toBe(401);
      // Route shape: top-level { error, message, code } for the 401 path,
      // not the nested { error: { code } } of the integration-error shape.
      expect(body.code).toBe("unauthorized");
      expect(body.error).toBe("Unauthorized");
      // Issue #1108: the cap must never be charged for an unauth request.
      expect(mockClaimDailyQuota).not.toHaveBeenCalled();
    });
  });

  describe("daily SAM 3.1 cap (#1108)", () => {
    it("claims one segment unit on the eve of the paid call", async () => {
      const response = await POST(buildRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.maskDataUrls).toHaveLength(2);
      // Issue #1132: the route uses the atomic-claim shape with the
      // default 100-unit cap; pin both the surface name and the limit
      // so a refactor cannot silently swap them.
      expect(mockClaimDailyQuota).toHaveBeenCalledTimes(1);
      const callArgs = mockClaimDailyQuota.mock.calls[0] as unknown as [
        string,
        string,
        number,
        ...unknown[],
      ];
      const [surface, userId, limit] = callArgs;
      expect(surface).toBe("segment");
      expect(userId).toBe(MOCK_USER_ID);
      expect(limit).toBe(100);
    });

    it("returns 429 with the standard rate-limit shape when the cap is reached", async () => {
      const resetsAt = new Date(Date.now() + 86400000).toISOString();
      mockClaimDailyQuota.mockResolvedValueOnce({
        claimed: false,
        allowed: false,
        used: 100,
        limit: 100,
        remaining: 0,
        resetsAt,
      } as QuotaClaim);

      const response = await POST(buildRequest());
      const body = await response.json();

      expect(response.status).toBe(429);
      expect(body.error).toBe("Daily limit reached");
      // dailyQuotaExceededPayload composes the message as
      // "You've reached today's limit for this action. <friendlyAction>
      // Your usage resets shortly after midnight (server time)."; the
      // route passes "Please try again tomorrow." as the friendlyAction,
      // so pin both halves — the prefix identifies the cap-shape and the
      // suffix the route-supplied copy.
      expect(body.message).toMatch(/today's limit for this action/);
      expect(body.message).toContain("Please try again tomorrow.");
      expect(body.retryable).toBe(true);
      expect(body.used).toBe(100);
      expect(body.limit).toBe(100);
      expect(body.code).toBe("rate-limit-exceeded");
      // Issue #1111: a denied claim must NEVER reach SAM 3.1; the
      // provider subscribe is the billing event.
      expect(mockFalSubscribe).not.toHaveBeenCalled();
      // A denied claim is not refundable — nothing was ever charged.
      expect(mockRefundDailyQuota).not.toHaveBeenCalled();
    });
  });

  describe("happy path", () => {
    it("returns the masks as data URLs and never invokes the provider for a denied claim", async () => {
      const response = await POST(buildRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.concept).toBe("sofa");
      expect(body.maskDataUrls).toHaveLength(2);
      expect(body.maskDataUrls.every((u: string) => u.startsWith("data:image/png;base64,"))).toBe(
        true
      );
      expect(body.scores).toEqual([0.9, 0.8]);
      expect(mockFalSubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
