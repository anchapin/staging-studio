import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/prisma", () => ({
  prisma: {
    rateLimitEntry: {
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import {
  slidingWindowRateLimit,
  getCurrentCount,
} from "@/lib/sliding-window-ratelimit";
import { prisma } from "@/lib/prisma";

const TEST_IDENTIFIER = "test-user-832";
const TEST_LIMIT = 5;
const TEST_WINDOW_MS = 1000; // 1 second window for fast testing

describe("slidingWindowRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the first request within a window", async () => {
    vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.rateLimitEntry.create).mockResolvedValue({
      id: "1",
      identifier: TEST_IDENTIFIER,
      windowStart: BigInt(0),
      count: 1,
      expiresAt: new Date(),
    } as never);

    const result = await slidingWindowRateLimit(
      TEST_IDENTIFIER,
      TEST_LIMIT,
      TEST_WINDOW_MS
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(TEST_LIMIT - 1);
    expect(result.limit).toBe(TEST_LIMIT);
  });

  it("counts requests within the sliding window", async () => {
    // Simulates sequential requests in the same window
    // Request 1: no existing entry, creates with count=1
    // Request 2: finds entry with count=1, updates to count=2
    // Request 3: finds entry with count=2, updates to count=3

    vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 0 } as never);

    const now = new Date();
    const windowStart = BigInt(Math.floor(now.getTime() / TEST_WINDOW_MS) * TEST_WINDOW_MS);

    // First request: no entry exists
    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.rateLimitEntry.create).mockResolvedValue({
      id: "1",
      identifier: TEST_IDENTIFIER,
      windowStart,
      count: 1,
      expiresAt: new Date(),
    } as never);

    const result1 = await slidingWindowRateLimit(
      TEST_IDENTIFIER,
      TEST_LIMIT,
      TEST_WINDOW_MS,
      now
    );
    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(TEST_LIMIT - 1);

    // Second request: entry exists with count=1
    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValueOnce({
      id: "1",
      identifier: TEST_IDENTIFIER,
      windowStart,
      count: 1,
      expiresAt: new Date(),
    } as never);
    vi.mocked(prisma.rateLimitEntry.update).mockResolvedValue({
      id: "1",
      identifier: TEST_IDENTIFIER,
      windowStart,
      count: 2,
      expiresAt: new Date(),
    } as never);

    const result2 = await slidingWindowRateLimit(
      TEST_IDENTIFIER,
      TEST_LIMIT,
      TEST_WINDOW_MS,
      now
    );
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(TEST_LIMIT - 2);

    // Third request: entry exists with count=2
    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValueOnce({
      id: "1",
      identifier: TEST_IDENTIFIER,
      windowStart,
      count: 2,
      expiresAt: new Date(),
    } as never);
    vi.mocked(prisma.rateLimitEntry.update).mockResolvedValue({
      id: "1",
      identifier: TEST_IDENTIFIER,
      windowStart,
      count: 3,
      expiresAt: new Date(),
    } as never);

    const result3 = await slidingWindowRateLimit(
      TEST_IDENTIFIER,
      TEST_LIMIT,
      TEST_WINDOW_MS,
      now
    );
    expect(result3.allowed).toBe(true);
    expect(result3.remaining).toBe(TEST_LIMIT - 3);
  });

  it("blocks requests exceeding the limit within the same window", async () => {
    const now = new Date();
    const windowStart = BigInt(Math.floor(now.getTime() / TEST_WINDOW_MS) * TEST_WINDOW_MS);

    vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValue({
      id: "1",
      identifier: TEST_IDENTIFIER,
      windowStart,
      count: TEST_LIMIT, // Already at limit
      expiresAt: new Date(),
    } as never);

    const result = await slidingWindowRateLimit(
      TEST_IDENTIFIER,
      TEST_LIMIT,
      TEST_WINDOW_MS,
      now
    );

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(TEST_LIMIT);
  });

  it("resets the window after windowMs expires", async () => {
    const now = new Date();
    const windowStart = BigInt(Math.floor(now.getTime() / TEST_WINDOW_MS) * TEST_WINDOW_MS);

    // First call: at limit, blocked
    vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValue({
      id: "1",
      identifier: TEST_IDENTIFIER,
      windowStart,
      count: TEST_LIMIT,
      expiresAt: new Date(),
    } as never);

    const blocked = await slidingWindowRateLimit(
      TEST_IDENTIFIER,
      TEST_LIMIT,
      TEST_WINDOW_MS,
      now
    );
    expect(blocked.allowed).toBe(false);

    // Advance time past the window
    const afterWindow = new Date(now.getTime() + TEST_WINDOW_MS + 1);
    const newWindowStart = BigInt(Math.floor(afterWindow.getTime() / TEST_WINDOW_MS) * TEST_WINDOW_MS);

    // New window: should be allowed
    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.rateLimitEntry.create).mockResolvedValue({
      id: "2",
      identifier: TEST_IDENTIFIER,
      windowStart: newWindowStart,
      count: 1,
      expiresAt: new Date(),
    } as never);

    const result = await slidingWindowRateLimit(
      TEST_IDENTIFIER,
      TEST_LIMIT,
      TEST_WINDOW_MS,
      afterWindow
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(TEST_LIMIT - 1);
  });

  it("maintains separate counters for different identifiers", async () => {
    const now = new Date();
    const windowStart = BigInt(Math.floor(now.getTime() / TEST_WINDOW_MS) * TEST_WINDOW_MS);

    vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 0 } as never);

    // Track which identifier findFirst is being called for
    let findFirstCallCount = 0;
    vi.mocked(prisma.rateLimitEntry.findFirst).mockImplementation(() => {
      findFirstCallCount++;
      // First call: user-2 (new user, no entry)
      // Second call: user-1 (existing user at limit)
      if (findFirstCallCount === 1) {
        return null as never; // user-2 has no entry
      } else {
        return {
          id: "1",
          identifier: "user-1",
          windowStart,
          count: TEST_LIMIT,
          expiresAt: new Date(),
        } as never; // user-1 is at limit
      }
    });

    // Create mock for user-2's new entry
    vi.mocked(prisma.rateLimitEntry.create).mockResolvedValue({
      id: "2",
      identifier: "user-2",
      windowStart,
      count: 1,
      expiresAt: new Date(),
    } as never);

    // user-2 should be allowed (no existing entry)
    const result = await slidingWindowRateLimit(
      "user-2",
      TEST_LIMIT,
      TEST_WINDOW_MS,
      now
    );

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(TEST_LIMIT - 1);

    // user-1 should be blocked (at limit)
    const blockedResult = await slidingWindowRateLimit(
      "user-1",
      TEST_LIMIT,
      TEST_WINDOW_MS,
      now
    );

    expect(blockedResult.allowed).toBe(false);
    expect(blockedResult.remaining).toBe(0);
  });

  it("reports correct resetsAt timestamp", async () => {
    const now = new Date();
    const windowStart = Math.floor(now.getTime() / TEST_WINDOW_MS) * TEST_WINDOW_MS;
    const expectedReset = new Date(windowStart + TEST_WINDOW_MS);

    vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.rateLimitEntry.create).mockResolvedValue({
      id: "1",
      identifier: TEST_IDENTIFIER,
      windowStart: BigInt(windowStart),
      count: 1,
      expiresAt: new Date(),
    } as never);

    const result = await slidingWindowRateLimit(
      TEST_IDENTIFIER,
      TEST_LIMIT,
      TEST_WINDOW_MS,
      now
    );

    expect(result.resetsAt.getTime()).toBe(expectedReset.getTime());
  });

  it("cleans up expired entries", async () => {
    vi.mocked(prisma.rateLimitEntry.deleteMany).mockResolvedValue({ count: 5 } as never);
    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.rateLimitEntry.create).mockResolvedValue({
      id: "1",
      identifier: TEST_IDENTIFIER,
      windowStart: BigInt(0),
      count: 1,
      expiresAt: new Date(),
    } as never);

    await slidingWindowRateLimit(TEST_IDENTIFIER, TEST_LIMIT, TEST_WINDOW_MS);

    expect(prisma.rateLimitEntry.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.rateLimitEntry.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          lt: expect.any(Date),
        },
      },
    });
  });
});

describe("getCurrentCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when no entries exist", async () => {
    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValue(null as never);

    const count = await getCurrentCount(TEST_IDENTIFIER, TEST_WINDOW_MS);
    expect(count).toBe(0);
  });

  it("returns current count after requests", async () => {
    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValue({
      id: "1",
      identifier: TEST_IDENTIFIER,
      windowStart: BigInt(0),
      count: 2,
      expiresAt: new Date(),
    } as never);

    const count = await getCurrentCount(TEST_IDENTIFIER, TEST_WINDOW_MS);
    expect(count).toBe(2);
  });

  it("returns 0 for a different window", async () => {
    const now = new Date();
    const later = new Date(now.getTime() + TEST_WINDOW_MS + 1);

    vi.mocked(prisma.rateLimitEntry.findFirst).mockResolvedValue(null as never);

    const count = await getCurrentCount(TEST_IDENTIFIER, TEST_WINDOW_MS, later);
    expect(count).toBe(0);
  });
});
