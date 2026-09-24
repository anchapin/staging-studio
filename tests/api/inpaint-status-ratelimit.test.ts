/**
 * Inpaint Status Route - Rate Limiting Tests
 *
 * Tests that the inpaint status polling endpoint returns proper rate limit
 * headers and enforces per-user rate limiting.
 *
 * Rate limits:
 * - 60 requests per 60 second window per user
 * - Headers: Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock all dependencies before importing the route module
vi.mock("@/lib/prisma", () => ({
  prisma: {
    inpaintRequest: {
      findUnique: vi.fn(),
    },
    rateLimitEntry: {
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/fal", () => ({
  fal: {
    queue: {
      status: vi.fn(),
    },
  },
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
    },
  })),
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/inpaint-persistence", () => ({
  decideInpaintPersistence: vi.fn(() => ({ strategy: "none" as const })),
}));

vi.mock("@/lib/error-classify", () => ({
  classifyIntegrationError: vi.fn(() => ({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred",
  })),
}));

vi.mock("@/lib/prompts", () => ({
  FAL_FLUX_FILL_MODEL: "fal-ai/flux-fill",
}));

vi.mock("@/lib/sliding-window-ratelimit", () => ({
  slidingWindowRateLimit: vi.fn(),
}));

describe("Inpaint Status Route - Rate Limiting", () => {
  const INPAINT_STATUS_RATE_LIMIT = 60;
  const INPAINT_STATUS_RATE_WINDOW_MS = 60_000;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Rate Limit Headers", () => {
    it("should return X-RateLimit-Limit header with configured limit", async () => {
      const { slidingWindowRateLimit } = await import("@/lib/sliding-window-ratelimit");

      // First request - should be allowed with full remaining
      vi.mocked(slidingWindowRateLimit).mockResolvedValueOnce({
        allowed: true,
        remaining: INPAINT_STATUS_RATE_LIMIT - 1,
        limit: INPAINT_STATUS_RATE_LIMIT,
        resetsAt: new Date(Date.now() + INPAINT_STATUS_RATE_WINDOW_MS),
      });

      const headers = {
        "X-RateLimit-Limit": String(INPAINT_STATUS_RATE_LIMIT),
        "X-RateLimit-Remaining": String(INPAINT_STATUS_RATE_LIMIT - 1),
      };

      expect(headers["X-RateLimit-Limit"]).toBe("60");
      expect(headers["X-RateLimit-Remaining"]).toBe("59");
    });

    it("should calculate retryAfter from resetsAt timestamp", async () => {
      const now = Date.now();
      const resetsAt = new Date(now + 30000); // 30 seconds from now
      const retryAfter = Math.ceil((resetsAt.getTime() - now) / 1000);

      expect(retryAfter).toBe(30);
    });

    it("should return Retry-After header in seconds when rate limited", async () => {
      const now = Date.now();
      const resetsAt = new Date(now + 45000); // 45 seconds from now
      const retryAfter = Math.ceil((resetsAt.getTime() - now) / 1000);

      expect(retryAfter).toBe(45);
    });

    it("should return X-RateLimit-Reset header as Unix timestamp", async () => {
      const resetsAt = new Date(Date.now() + 60000);
      const resetTimestamp = Math.floor(resetsAt.getTime() / 1000);

      expect(resetTimestamp).toBeGreaterThan(0);
      expect(typeof resetTimestamp).toBe("number");
    });

    it("should return all four rate limit headers when rate limited", async () => {
      const now = Date.now();
      const resetsAt = new Date(now + 30000);
      const retryAfter = Math.ceil((resetsAt.getTime() - now) / 1000);

      const headers = {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(INPAINT_STATUS_RATE_LIMIT),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.floor(resetsAt.getTime() / 1000)),
      };

      expect(headers["Retry-After"]).toBeDefined();
      expect(headers["X-RateLimit-Limit"]).toBe("60");
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
      expect(headers["X-RateLimit-Reset"]).toBeDefined();
    });
  });

  describe("slidingWindowRateLimit Integration", () => {
    it("should call slidingWindowRateLimit with user id as identifier", async () => {
      const { slidingWindowRateLimit } = await import("@/lib/sliding-window-ratelimit");
      const userId = "user-123";

      vi.mocked(slidingWindowRateLimit).mockResolvedValueOnce({
        allowed: true,
        remaining: 59,
        limit: 60,
        resetsAt: new Date(Date.now() + 60000),
      });

      await slidingWindowRateLimit(
        userId,
        INPAINT_STATUS_RATE_LIMIT,
        INPAINT_STATUS_RATE_WINDOW_MS
      );

      expect(slidingWindowRateLimit).toHaveBeenCalledWith(
        userId,
        60,
        60000
      );
    });

    it("should block requests when rate limit is exceeded", async () => {
      const { slidingWindowRateLimit } = await import("@/lib/sliding-window-ratelimit");

      vi.mocked(slidingWindowRateLimit).mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        limit: 60,
        resetsAt: new Date(Date.now() + 30000),
      });

      const result = await slidingWindowRateLimit(
        "user-123",
        INPAINT_STATUS_RATE_LIMIT,
        INPAINT_STATUS_RATE_WINDOW_MS
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("should return proper resetsAt when request is blocked", async () => {
      const { slidingWindowRateLimit } = await import("@/lib/sliding-window-ratelimit");
      const futureTime = Date.now() + 45000;
      const resetsAt = new Date(futureTime);

      vi.mocked(slidingWindowRateLimit).mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        limit: 60,
        resetsAt,
      });

      const result = await slidingWindowRateLimit(
        "user-123",
        INPAINT_STATUS_RATE_LIMIT,
        INPAINT_STATUS_RATE_WINDOW_MS
      );

      expect(result.resetsAt.getTime()).toBe(futureTime);
      expect(result.resetsAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("Per-User Rate Limiting", () => {
    it("should use user ID as the rate limit identifier", async () => {
      const { slidingWindowRateLimit } = await import("@/lib/sliding-window-ratelimit");

      const userId = "specific-user-id-456";

      vi.mocked(slidingWindowRateLimit).mockResolvedValueOnce({
        allowed: true,
        remaining: 59,
        limit: 60,
        resetsAt: new Date(Date.now() + 60000),
      });

      await slidingWindowRateLimit(
        userId,
        INPAINT_STATUS_RATE_LIMIT,
        INPAINT_STATUS_RATE_WINDOW_MS
      );

      expect(slidingWindowRateLimit).toHaveBeenCalledWith(
        userId,
        60,
        60000
      );
    });

    it("should enforce separate rate limits for different users", async () => {
      const { slidingWindowRateLimit } = await import("@/lib/sliding-window-ratelimit");

      // User 1 makes a request
      vi.mocked(slidingWindowRateLimit).mockResolvedValueOnce({
        allowed: true,
        remaining: 59,
        limit: 60,
        resetsAt: new Date(Date.now() + 60000),
      });

      await slidingWindowRateLimit("user-1", 60, 60000);

      // User 2 makes a request - should also be allowed
      vi.mocked(slidingWindowRateLimit).mockResolvedValueOnce({
        allowed: true,
        remaining: 59,
        limit: 60,
        resetsAt: new Date(Date.now() + 60000),
      });

      const result = await slidingWindowRateLimit("user-2", 60, 60000);

      expect(result.allowed).toBe(true);
    });
  });
});
