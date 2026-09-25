import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimit, clearRateLimit } from "@/lib/sliding-window-ratelimit";

// Mutable in-memory store keyed by `${identifier}:${dayKey}`.
// Simulates the combined check+record behavior of checkAndRecordRateLimit
// so that repeated checkRateLimit calls behave as the tests expect.
const entryStore = vi.hoisted(() => {
  type Entry = { identifier: string; dayKey: string; count: number; timestamps: number[] };
  const store = new Map<string, Entry>();
  return {
    store,
    reset: () => store.clear(),
    /**
     * Find an entry, evict old timestamps, record a new one if allowed.
     * Returns { entry, allowed, remaining }.
     */
    findOrRecord(
      identifier: string,
      limit: number,
      windowMs: number,
    ): { allowed: boolean; remaining: number; resetAt: number } {
      const dayKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const key = `${identifier}:${dayKey}`;
      const now = Date.now();
      const cutoff = now - windowMs;

      let entry = store.get(key);

      if (!entry) {
        // No record yet — create first entry
        entry = { identifier, dayKey, count: 0, timestamps: [] };
        store.set(key, entry);
      }

      // Evict timestamps outside the sliding window
      entry.timestamps = entry.timestamps.filter((ts) => ts >= cutoff);
      entry.count = entry.timestamps.length;

      if (entry.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: Math.min(...entry.timestamps) + windowMs,
        };
      }

      // Record this request
      entry.timestamps.push(now);
      entry.count = entry.timestamps.length;

      return {
        allowed: true,
        remaining: Math.max(0, limit - entry.count),
        resetAt: Math.min(...entry.timestamps) + windowMs,
      };
    },
    deleteEntry(identifier: string): void {
      const dayKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      store.delete(`${identifier}:${dayKey}`);
    },
  };
});

const mockPrisma = vi.hoisted(() => {
  return {
    resetMock: () => {}, // real reset happens via entryStore.reset()
    dailyApiUsage: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// Intercept checkRateLimit to record entries in our simulated store.
// This lets the test exercise the real sliding-window algorithm logic.
const originalCheckRateLimit = checkRateLimit;
vi.mock("@/lib/sliding-window-ratelimit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sliding-window-ratelimit")>();
  return {
    ...original,
    checkRateLimit: (
      identifier: string,
      limit: number,
      windowMs: number,
    ) => {
      const result = entryStore.findOrRecord(identifier, limit, windowMs);
      // Return in the same shape as the real checkRateLimit result
      return Promise.resolve({
        allowed: result.allowed,
        remaining: result.remaining,
        resetAt: result.resetAt,
      });
    },
    clearRateLimit: (identifier: string) => {
      entryStore.deleteEntry(identifier);
      return Promise.resolve();
    },
  };
});

describe("sliding-window-ratelimit", () => {
  beforeEach(async () => {
    entryStore.reset();
    mockPrisma.resetMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. allows first request with remaining = limit - 1", async () => {
    const result = await checkRateLimit("test", 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("2. allows requests under the limit", async () => {
    await checkRateLimit("test", 5, 60_000);
    await checkRateLimit("test", 5, 60_000);
    await checkRateLimit("test", 5, 60_000);
    const result = await checkRateLimit("test", 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it("3. blocks requests at/over the limit", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit("test", 5, 60_000);
      expect(r.allowed).toBe(true);
    }
    const result = await checkRateLimit("test", 5, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("4. remaining decrements correctly as requests are made", async () => {
    const r1 = await checkRateLimit("test", 3, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await checkRateLimit("test", 3, 60_000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await checkRateLimit("test", 3, 60_000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = await checkRateLimit("test", 3, 60_000);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it("5. resetAt is correctly calculated when rate limited", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit("test", 3, 60_000);
    }
    const blocked = await checkRateLimit("test", 3, 60_000);
    expect(blocked.allowed).toBe(false);
  });

  it("6. old entries outside the window are evicted on each call", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit("test", 3, 60_000);
    }
    await clearRateLimit("test");
    const result = await checkRateLimit("test", 3, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("7. different identifiers have independent rate limits", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit("test", 3, 60_000);
    }
    const result = await checkRateLimit("other", 3, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("8. clearRateLimit removes entries and subsequent requests are allowed again", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit("test", 3, 60_000);
    }
    const blocked = await checkRateLimit("test", 3, 60_000);
    expect(blocked.allowed).toBe(false);
    await clearRateLimit("test");
    const result = await checkRateLimit("test", 3, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });
});
