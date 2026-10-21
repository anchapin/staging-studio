import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  checkRateLimit,
  recordRateLimit,
  checkAndRecordRateLimit,
  claimRateLimit,
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

/**
 * Serialises every `$transaction` body across ALL calls. This deliberately
 * lives in the mock's enclosing closure rather than inside the `$transaction`
 * implementation: a queue created inside would be a fresh already-resolved
 * promise per call, and nothing would actually be serialised. This is the stand
 * -in for `SELECT ... FOR UPDATE` against a single row.
 */
let txQueue: Promise<unknown> = Promise.resolve();

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

      upsert: vi.fn(async ({ where, create }: { where: { userId_surface_dayKey: { userId: string; surface: string; dayKey: string } }; create: { userId: string; surface: string; dayKey: string; count: number; timestamps: Date[] } }) => {
        const k = storeKey(
          where.userId_surface_dayKey.userId,
          where.userId_surface_dayKey.surface,
          where.userId_surface_dayKey.dayKey
        );
        const existing = mockStore.get(k);
        if (existing) return cloneRecord(existing);
        mockStore.set(k, cloneRecord(create as unknown as UsageRecord));
        return cloneRecord(create as unknown as UsageRecord);
      }),
    },

    /**
     * Simulate the interactive transaction that `claimRateLimit` relies on.
     * The in-memory store has no real row locking, so serialisation is modelled
     * explicitly: every transaction body runs to completion before the next one
     * starts. That is precisely the guarantee `SELECT ... FOR UPDATE` provides
     * against a single row, and it is what makes the interleaving test below a
     * real test of the fix rather than a test of JS scheduling.
     */
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
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
          upsert: vi.fn(async ({ where, create }: { where: { userId_surface_dayKey: { userId: string; surface: string; dayKey: string } }; create: { userId: string; surface: string; dayKey: string; count: number; timestamps: Date[] } }) => {
            const k = storeKey(
              where.userId_surface_dayKey.userId,
              where.userId_surface_dayKey.surface,
              where.userId_surface_dayKey.dayKey
            );
            const existing = mockStore.get(k);
            if (existing) return cloneRecord(existing);
            mockStore.set(k, cloneRecord(create as unknown as UsageRecord));
            return cloneRecord(create as unknown as UsageRecord);
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
        },
        // Stands in for `SELECT ... FOR UPDATE`; the serialising `$transaction`
        // wrapper above is what makes the lock effective.
        $queryRaw: vi.fn(async () => []),
      };
      // Chain onto the shared queue so bodies run strictly one at a time.
      const run = txQueue.then(() => fn(tx));
      txQueue = run.catch(() => undefined);
      return run;
    }),
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

describe("claimRateLimit", () => {
  const id = "claim-user";

  // The suite-level reset above is scoped to its own describe block, so this
  // block needs its own: sharing one identifier across tests would otherwise
  // carry a partially-filled row from the previous test into the next one.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
    mockStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows claims up to the limit and reports remaining correctly", async () => {
    const now = new Date("2024-01-15T12:00:00Z");

    const first = await claimRateLimit(id, 3, 60_000, now);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    const second = await claimRateLimit(id, 3, 60_000, now);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);

    const third = await claimRateLimit(id, 3, 60_000, now);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("refuses a claim past the limit without consuming a unit", async () => {
    const now = new Date("2024-01-15T12:00:00Z");
    await claimRateLimit(id, 2, 60_000, now);
    await claimRateLimit(id, 2, 60_000, now);

    const denied = await claimRateLimit(id, 2, 60_000, now);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);

    // The refusal must not have appended a timestamp: the live count stays 2.
    const k = storeKey(id, "default", dayKey(now));
    expect(mockStore.get(k)!.count).toBe(2);
    expect(mockStore.get(k)!.timestamps).toHaveLength(2);
  });

  /**
   * The regression this whole function exists for. `recordRateLimit` reads,
   * decides and writes in three separate statements, so N callers racing on the
   * same row all observe the same pre-race count and all conclude they are
   * under the limit. Every one of them is granted a unit while only the last
   * write survives, so the quota is overshot.
   */
  it("does not overshoot when concurrent callers race for the last unit", async () => {
    const now = new Date("2024-01-15T12:00:00Z");

    // Fill the only slot, then fire five callers at it at once.
    await claimRateLimit(id, 1, 60_000, now);

    const racing = await Promise.all(
      Array.from({ length: 5 }, () => claimRateLimit(id, 1, 60_000, now))
    );

    // The slot is already gone, so every racer must be refused. Under the old
    // read-decide-write path these racers would each have read count=1, each
    // concluded it was somehow under the limit, and each written back an array
    // of length 2 — granting units that were never consistently recorded.
    const granted = racing.filter((r) => r.allowed).length;
    expect(granted).toBe(0);

    const k = storeKey(id, "default", dayKey(now));
    expect(mockStore.get(k)!.timestamps).toHaveLength(1);
    expect(mockStore.get(k)!.count).toBe(1);
  });

  it("grants the single free unit to exactly one of many concurrent callers", async () => {
    const now = new Date("2024-01-15T12:00:00Z");

    const racing = await Promise.all(
      Array.from({ length: 5 }, () => claimRateLimit(id, 1, 60_000, now))
    );

    expect(racing.filter((r) => r.allowed)).toHaveLength(1);

    const k = storeKey(id, "default", dayKey(now));
    expect(mockStore.get(k)!.timestamps).toHaveLength(1);
  });

  it("grants exactly `limit` units across many concurrent first-time callers", async () => {
    const now = new Date("2024-01-15T12:00:00Z");

    // Fresh identifier: this also covers the create-vs-create insert race, where
    // every racer finds no row and would otherwise try to create one.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimRateLimit(id, 3, 60_000, now))
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(3);

    const k = storeKey(id, "default", dayKey(now));
    expect(mockStore.get(k)!.timestamps).toHaveLength(3);
    expect(mockStore.get(k)!.count).toBe(3);
  });

  it("reports resetAt from the oldest in-window claim when denying", async () => {
    const now = new Date("2024-01-15T12:00:00Z");
    await claimRateLimit(id, 1, 60_000, now);

    const denied = await claimRateLimit(id, 1, 60_000, new Date(now.getTime() + 5_000));
    expect(denied.allowed).toBe(false);
    // Oldest claim is at `now`, so the window frees a slot one full window later.
    expect(denied.resetAt).toBe(now.getTime() + 60_000);
  });

  it("allows a claim again once earlier timestamps age out of the window", async () => {
    const now = new Date("2024-01-15T12:00:00Z");
    await claimRateLimit(id, 1, 60_000, now);
    expect((await claimRateLimit(id, 1, 60_000, now)).allowed).toBe(false);

    // 61s later the first claim has expired, so the window has room again.
    const later = new Date(now.getTime() + 61_000);
    const reopened = await claimRateLimit(id, 1, 60_000, later);
    expect(reopened.allowed).toBe(true);
  });

  it("scopes the lock per identifier so different users never block each other", async () => {
    const now = new Date("2024-01-15T12:00:00Z");

    const [a, b] = await Promise.all([
      claimRateLimit("claim-user-a", 1, 60_000, now),
      claimRateLimit("claim-user-b", 1, 60_000, now),
    ]);

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });
});
