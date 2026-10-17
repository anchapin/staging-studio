import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  checkRateLimit,
  recordRateLimit,
  checkAndRecordRateLimit,
  clearRateLimit,
  dayKey,
} from "@/lib/sliding-window-ratelimit";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

/** In-memory store keyed by `{userId}:{surface}:{dayKey}`. */
interface UsageRecord {
  userId: string;
  surface: string;
  dayKey: string;
  count: number;
  timestamps: Date[];
}

const mockStore = new Map<string, UsageRecord>();

function storeKey(userId: string, surface: string, dayKey: string): string {
  return `${userId}::${surface}::${dayKey}`;
}

function cloneRecord(r: UsageRecord): UsageRecord {
  return { ...r, timestamps: [...r.timestamps] };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyApiUsage: {
      findUnique: vi.fn(async ({ where }: { where: { userId_surface_dayKey: { userId: string; surface: string; dayKey: string } } }) => {
        const k = storeKey(
          where.userId_surface_dayKey.userId,
          where.userId_surface_dayKey.surface,
          where.userId_surface_dayKey.dayKey
        );
        const rec = mockStore.get(k);
        return rec ? cloneRecord(rec) : null;
      }),

      create: vi.fn(async ({ data }: { data: { userId: string; surface: string; dayKey: string; count: number; timestamps: Date[] } }) => {
        const k = storeKey(data.userId, data.surface, data.dayKey);
        mockStore.set(k, cloneRecord(data as unknown as UsageRecord));
        return cloneRecord(data as unknown as UsageRecord);
      }),

      update: vi.fn(async ({ where, data }: { where: { userId_surface_dayKey: { userId: string; surface: string; dayKey: string } }; data: { count?: number; timestamps?: Date[] } }) => {
        const k = storeKey(
          where.userId_surface_dayKey.userId,
          where.userId_surface_dayKey.surface,
          where.userId_surface_dayKey.dayKey
        );
        const existing = mockStore.get(k);
        if (!existing) return null;
        if (data.count !== undefined) existing.count = data.count;
        if (data.timestamps !== undefined) existing.timestamps = [...data.timestamps];
        return cloneRecord(existing);
      }),

      deleteMany: vi.fn(async ({ where }: { where: { userId: string; surface: string; dayKey: string } }) => {
        const k = storeKey(where.userId, where.surface, where.dayKey);
        const had = mockStore.has(k);
        mockStore.delete(k);
        return { count: had ? 1 : 0 };
      }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sliding-window-ratelimit", () => {
  // Use vitest fake timers so the window-reset test is deterministic
  // and instant. The module reads Date.now() internally — vi.useFakeTimers
  // stubs that globally for the test.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
    mockStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- checkRateLimit --------------------------------------------------------

  it("1. checkRateLimit allows first request with remaining = limit - 1", async () => {
    const result = await checkRateLimit("test", 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("2. checkRateLimit allows requests under the limit (limit > 1, check-only)", async () => {
    // checkRateLimit does not record; use checkAndRecordRateLimit for that.
    // These calls exercise the real DB reads without side-effects.
    const r1 = await checkRateLimit("test", 5, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(4);

    const r2 = await checkRateLimit("test", 5, 60_000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(4);

    const r3 = await checkRateLimit("test", 5, 60_000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(4);
  });

  it("3. checkAndRecordRateLimit blocks the 6th request when limit = 5", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await checkAndRecordRateLimit("test", 5, 60_000);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkAndRecordRateLimit("test", 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("4. remaining decrements correctly with checkAndRecordRateLimit", async () => {
    const r1 = await checkAndRecordRateLimit("test", 3, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await checkAndRecordRateLimit("test", 3, 60_000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await checkAndRecordRateLimit("test", 3, 60_000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = await checkAndRecordRateLimit("test", 3, 60_000);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it("5. resetAt is set when rate limited", async () => {
    for (let i = 0; i < 5; i++) {
      await checkAndRecordRateLimit("test", 5, 60_000);
    }
    const blocked = await checkAndRecordRateLimit("test", 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetAt).toBeGreaterThan(Date.now());
  });

  it("6. clearRateLimit removes the record and subsequent requests are allowed again", async () => {
    for (let i = 0; i < 3; i++) {
      await checkAndRecordRateLimit("test", 3, 60_000);
    }
    const blocked = await checkAndRecordRateLimit("test", 3, 60_000);
    expect(blocked.allowed).toBe(false);
    await clearRateLimit("test");
    const result = await checkRateLimit("test", 3, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("7. different identifiers have independent rate limits", async () => {
    for (let i = 0; i < 3; i++) {
      await checkAndRecordRateLimit("test", 3, 60_000);
    }
    const result = await checkAndRecordRateLimit("other", 3, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  // --- recordRateLimit (standalone) ------------------------------------------

  it("8. recordRateLimit records and returns correct remaining", async () => {
    const r1 = await recordRateLimit("test", 4, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(3);

    const r2 = await recordRateLimit("test", 4, 60_000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(2);

    const r3 = await recordRateLimit("test", 4, 60_000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(1);

    const r4 = await recordRateLimit("test", 4, 60_000);
    expect(r4.allowed).toBe(true);
    expect(r4.remaining).toBe(0);

    const r5 = await recordRateLimit("test", 4, 60_000);
    expect(r5.allowed).toBe(false);
    expect(r5.remaining).toBe(0);
  });

  // --- Limit > 1 regression cases -------------------------------------------

  it("9. checkRateLimit honors limit > 1 (limit=5 with 2 prior requests is still allowed)", async () => {
    // Manually seed the store with 2 prior records to simulate an existing usage entry.
    // Use the same dayKey function as the source to ensure consistent key generation.
    const fixedDate = new Date("2024-01-15T12:00:00Z");
    const entry = {
      userId: "test",
      surface: "default",
      dayKey: dayKey(fixedDate), // Use same dayKey function to ensure consistency
      count: 2,
      timestamps: [fixedDate, fixedDate],
    };
    const k = storeKey(entry.userId, entry.surface, entry.dayKey);
    mockStore.set(k, entry);

    // With limit=5 and 2 valid timestamps within window, remaining = 5 - 2 = 3
    const result = await checkRateLimit("test", 5, 60_000, fixedDate);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it("10. checkAndRecordRateLimit correctly uses limit > 1 (limit=5, 5th request is allowed, 6th is blocked)", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await checkAndRecordRateLimit("user5", 5, 60_000);
      results.push(r.allowed);
    }
    expect(results).toEqual([true, true, true, true, true, false]);
    // If the old bug were present (limit treated as 1), results would be [true, false, false, false, false, false]
  });

  it("11. after all timestamps expire, remaining resets to limit (window is fresh)", async () => {
    // Seed with 2 timestamps that will be outside the window
    // 2 minutes ago is outside 60s window
    const expiredDate = new Date("2024-01-15T11:58:00Z");
    const entry = {
      userId: "expire-test",
      surface: "default",
      dayKey: dayKey(expiredDate),
      count: 2,
      timestamps: [expiredDate, expiredDate],
    };
    const k = storeKey(entry.userId, entry.surface, entry.dayKey);
    mockStore.set(k, entry);

    // Current time is 12:00:00, timestamps are at 11:58:00 (2 minutes ago)
    // windowMs = 60_000 (60 seconds), so timestamps are outside the window
    // After cleanup, remaining should be limit (window is fresh)
    const fixedDate = new Date("2024-01-15T12:00:00Z");
    const result = await checkRateLimit("expire-test", 5, 60_000, fixedDate);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5); // Window is fresh after cleanup
  });
});
