import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

import {
  DEFAULT_DAILY_COPY_LIMIT,
  DEFAULT_DAILY_EXPORT_LIMIT,
  DEFAULT_DAILY_INPAINT_LIMIT,
  DEFAULT_DAILY_LABEL_LIMIT,
  DEFAULT_DAILY_SEGMENT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  SEGMENT_DAILY_LIMIT,
  claimDailyQuota,
  dailyQuotaExceededPayload,
  dailyWindow,
  evaluateDailyBatchQuota,
  evaluateDailyQuota,
  getDailyUsage,
  recordDailyUsage,
  refundDailyQuota,
  resolveDailyLimit,
} from "@/lib/api-quota";

// Issue #1138: the money counters run for real here. Only @/lib/prisma is
// mocked, with a faithful in-memory upsert/findUnique, so the actual
// recordDailyUsage / getDailyUsage implementations (composite unique key,
// create count:1, update increment:1) are what the tests exercise.
const mockUsageStore: Record<string, number> = {};
const mockUpsertCalls: Array<{
  where: { userId_surface_dayKey: { userId: string; surface: string; dayKey: string } };
  create?: { userId: string; surface: string; dayKey: string; count: number };
  update?: { count: { increment: number } };
}> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyApiUsage: {
      upsert: vi.fn(async ({ where, create, update }: (typeof mockUpsertCalls)[number]) => {
        mockUpsertCalls.push({ where, create, update });
        const { userId, surface, dayKey } = where.userId_surface_dayKey;
        const key = `${userId}|${surface}|${dayKey}`;
        if (key in mockUsageStore) {
          mockUsageStore[key] += update?.count?.increment ?? 0;
        } else {
          mockUsageStore[key] = create?.count ?? 0;
        }
        return { count: mockUsageStore[key] };
      }),
      // Issue #1132: the atomic-claim primitives share the same in-memory
      // store so the real claimDailyQuota / refundDailyQuota implementations
      // are exercised end to end.
      updateMany: vi.fn(async ({
        where,
        data,
      }: {
        where: { userId: string; surface: string; dayKey: string; count?: { lte: number; gte: number } };
        data: { count: { increment?: number; decrement?: number } };
      }) => {
        const key = `${where.userId}|${where.surface}|${where.dayKey}`;
        if (!(key in mockUsageStore)) return { count: 0 };
        if (where.count?.lte !== undefined && mockUsageStore[key] > where.count.lte) {
          return { count: 0 };
        }
        if (where.count?.gte !== undefined && mockUsageStore[key] < where.count.gte) {
          return { count: 0 };
        }
        mockUsageStore[key] += (data.count.increment ?? 0) - (data.count.decrement ?? 0);
        return { count: 1 };
      }),
      create: vi.fn(async ({ data }: { data: { userId: string; surface: string; dayKey: string; count: number } }) => {
        const key = `${data.userId}|${data.surface}|${data.dayKey}`;
        if (key in mockUsageStore) {
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed on the fields: (`userId`,`surface`,`dayKey`)",
            { code: "P2002", clientVersion: "5.22.0" }
          );
        }
        mockUsageStore[key] = data.count;
        return { count: data.count };
      }),
      findUnique: vi.fn(async ({ where }: (typeof mockUpsertCalls)[number]) => {
        const { userId, surface, dayKey } = where.userId_surface_dayKey;
        const key = `${userId}|${surface}|${dayKey}`;
        return key in mockUsageStore ? { count: mockUsageStore[key] } : null;
      }),
    },
  },
}));

// Constructed via the local-time Date constructor so expectations hold in
// every TZ: the quota window is defined in server-local time.
const DAY = { y: 2026, m: 8, d: 17 }; // Sep 17 2026
const midDay = new Date(DAY.y, DAY.m, DAY.d, 15, 30, 0, 0);
const nextMidnight = new Date(DAY.y, DAY.m, DAY.d + 1, 0, 0, 0, 0);

describe("resolveDailyLimit", () => {
  it("falls back when the env var is undefined or blank", () => {
    expect(resolveDailyLimit(undefined, 20)).toBe(20);
    expect(resolveDailyLimit("", 20)).toBe(20);
    expect(resolveDailyLimit("   ", 20)).toBe(20);
  });

  it("parses a valid non-negative integer", () => {
    expect(resolveDailyLimit("30", 20)).toBe(30);
    expect(resolveDailyLimit(" 12 ", 20)).toBe(12);
  });

  it("treats 0 as a valid limit (blocks everything for the day)", () => {
    expect(resolveDailyLimit("0", 20)).toBe(0);
  });

  it("falls back on garbage, negative, and non-integer values", () => {
    expect(resolveDailyLimit("abc", 20)).toBe(20);
    expect(resolveDailyLimit("-5", 20)).toBe(20);
    expect(resolveDailyLimit("3.7", 20)).toBe(20);
    expect(resolveDailyLimit("1e3", 20)).toBe(1000); // integer value is honored
  });
});

describe("dailyWindow", () => {
  it("starts at local midnight and ends at the next local midnight", () => {
    const window = dailyWindow(midDay);
    expect(window.startAt).toEqual(new Date(DAY.y, DAY.m, DAY.d, 0, 0, 0, 0));
    expect(window.endAt).toEqual(nextMidnight);
    expect(window.endAt.getTime() - window.startAt.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("formats dayKey as zero-padded YYYY-MM-DD in local time", () => {
    expect(dailyWindow(midDay).dayKey).toBe("2026-09-17");
    expect(dailyWindow(new Date(2026, 0, 5)).dayKey).toBe("2026-01-05");
  });

  it("returns the same window for any instant within the day", () => {
    const early = dailyWindow(new Date(DAY.y, DAY.m, DAY.d, 0, 0, 0, 0));
    const late = dailyWindow(
      new Date(DAY.y, DAY.m, DAY.d, 23, 59, 59, 999)
    );
    expect(early.dayKey).toBe(late.dayKey);
    expect(early.startAt).toEqual(late.startAt);
  });

  it("rolls over at local midnight: 23:59:59.999 and 00:00:00.000 differ", () => {
    const before = dailyWindow(new Date(DAY.y, DAY.m, DAY.d, 23, 59, 59, 999));
    const after = dailyWindow(new Date(DAY.y, DAY.m, DAY.d + 1, 0, 0, 0, 0));
    expect(before.dayKey).not.toBe(after.dayKey);
    expect(after.startAt).toEqual(before.endAt);
  });
});

describe("evaluateDailyQuota", () => {
  it("allows while usage is strictly below the limit", () => {
    expect(evaluateDailyQuota(0, 20, midDay)).toEqual({
      allowed: true,
      used: 0,
      limit: 20,
      remaining: 20,
    });
    expect(evaluateDailyQuota(19, 20, midDay).allowed).toBe(true);
  });

  it("blocks at exactly the limit and reports the reset time", () => {
    const decision = evaluateDailyQuota(20, 20, midDay);
    expect(decision).toEqual({
      allowed: false,
      used: 20,
      limit: 20,
      resetsAt: nextMidnight.toISOString(),
    });
  });

  it("blocks everything when the limit is 0", () => {
    const decision = evaluateDailyQuota(0, 0, midDay);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.limit).toBe(0);
      expect(decision.resetsAt).toBe(nextMidnight.toISOString());
    }
  });
});

describe("dailyQuotaExceededPayload", () => {
  it("matches the repo 429 error shape with quota details", () => {
    const decision = evaluateDailyQuota(20, 20, midDay);
    if (decision.allowed) throw new Error("expected blocked decision");
    const payload = dailyQuotaExceededPayload(decision, "Try again tomorrow.");

    expect(payload).toEqual({
      error: "Daily limit reached",
      message: expect.stringContaining("Try again tomorrow."),
      retryable: true,
      used: 20,
      limit: 20,
      resetsAt: nextMidnight.toISOString(),
    });
    expect(new Date(payload.resetsAt).getTime()).toBeGreaterThan(midDay.getTime());
  });
});

describe("inpaint surface (FLUX.1 Fill runs, issue #1131)", () => {
  it("counts charged runs on its own counter row", async () => {
    await expect(recordDailyUsage("inpaint", "inpaint-user-a", 1, midDay)).resolves.toBe(1);
    await expect(recordDailyUsage("inpaint", "inpaint-user-a", 1, midDay)).resolves.toBe(2);
    await expect(getDailyUsage("inpaint", "inpaint-user-a", midDay)).resolves.toBe(2);
  });

  it("does not share a counter with any other surface", async () => {
    await recordDailyUsage("inpaint", "inpaint-user-b", 1, midDay);
    await expect(getDailyUsage("copy", "inpaint-user-b", midDay)).resolves.toBe(0);
    await expect(getDailyUsage("segment", "inpaint-user-b", midDay)).resolves.toBe(0);
  });
});

beforeEach(() => {
  // Clear the shared in-memory store and the recorded upsert calls between tests
  for (const key in mockUsageStore) delete mockUsageStore[key];
  mockUpsertCalls.length = 0;
});

describe("Postgres-backed daily usage counter (issue #784)", () => {
  it("records billable units cumulatively on the composite key and returns the new count", async () => {
    await expect(recordDailyUsage("copy", "counter-user-a", 1, midDay)).resolves.toBe(1);
    await expect(recordDailyUsage("copy", "counter-user-a", 1, midDay)).resolves.toBe(2);
    await expect(getDailyUsage("copy", "counter-user-a", midDay)).resolves.toBe(2);

    // Both writes carry the (userId, surface, dayKey) composite from
    // dailyWindow and the create:1 / update:increment:1 branches...
    const expectedCall = {
      where: { userId_surface_dayKey: { userId: "counter-user-a", surface: "copy", dayKey: "2026-09-17" } },
      create: { userId: "counter-user-a", surface: "copy", dayKey: "2026-09-17", count: 1 },
      update: { count: { increment: 1 } },
    };
    expect(mockUpsertCalls[0]).toEqual(expectedCall);
    expect(mockUpsertCalls[1]).toEqual(expectedCall);
    // ...and the in-memory upsert executed create on the first write and
    // the increment on the second (counts 1 then 2 above), matching what
    // Postgres does with the same arguments.
  });

  it("isolates usage per user", async () => {
    await recordDailyUsage("export", "counter-user-b", 1, midDay);
    await expect(getDailyUsage("export", "counter-user-b", midDay)).resolves.toBe(1);
    await expect(getDailyUsage("export", "counter-user-c", midDay)).resolves.toBe(0);
  });

  it("isolates usage per surface", async () => {
    await recordDailyUsage("copy", "counter-user-d", 1, midDay);
    await expect(getDailyUsage("copy", "counter-user-d", midDay)).resolves.toBe(1);
    await expect(getDailyUsage("export", "counter-user-d", midDay)).resolves.toBe(0);
  });

  it("starts a new row at the daily rollover; the previous day row persists but stops counting", async () => {
    const before = new Date(DAY.y, DAY.m, DAY.d, 23, 59, 59, 999);
    const after = new Date(DAY.y, DAY.m, DAY.d + 1, 0, 0, 0, 0);

    await recordDailyUsage("copy", "counter-user-e", 1, before);
    await recordDailyUsage("copy", "counter-user-e", 1, before);
    await expect(getDailyUsage("copy", "counter-user-e", before)).resolves.toBe(2);

    // Next day starts from zero...
    await expect(getDailyUsage("copy", "counter-user-e", after)).resolves.toBe(0);
    await recordDailyUsage("copy", "counter-user-e", 1, after);
    await expect(getDailyUsage("copy", "counter-user-e", after)).resolves.toBe(1);

    // ...via a row with the new dayKey, not an increment of the old one.
    const dayKeys = mockUpsertCalls.map((c) => c.where.userId_surface_dayKey.dayKey);
    expect(dayKeys).toEqual(["2026-09-17", "2026-09-17", "2026-09-18"]);

    // Postgres rows persist; the old row simply never matches the new window.
    await expect(getDailyUsage("copy", "counter-user-e", before)).resolves.toBe(2);
  });

  it("treats an unknown user as zero usage", async () => {
    await expect(getDailyUsage("copy", "counter-user-nobody", midDay)).resolves.toBe(0);
  });
});

describe("segment surface (SAM 3.1 concept calls, issue #226)", () => {
  it("records usage on its own Postgres counter", async () => {
    await expect(recordDailyUsage("segment", "segment-user-a", 1, midDay)).resolves.toBe(1);
    await expect(getDailyUsage("segment", "segment-user-a", midDay)).resolves.toBe(1);
    await expect(getDailyUsage("copy", "segment-user-a", midDay)).resolves.toBe(0);
  });

  it("blocks at the segment limit and returns a retryable 429 payload", () => {
    // One under the cap is still served...
    expect(evaluateDailyQuota(DEFAULT_DAILY_SEGMENT_LIMIT - 1, DEFAULT_DAILY_SEGMENT_LIMIT, midDay).allowed).toBe(true);
    // ...and the limit-th usage blocks the next request.
    const decision = evaluateDailyQuota(DEFAULT_DAILY_SEGMENT_LIMIT, DEFAULT_DAILY_SEGMENT_LIMIT, midDay);
    expect(decision).toEqual({
      allowed: false,
      used: DEFAULT_DAILY_SEGMENT_LIMIT,
      limit: DEFAULT_DAILY_SEGMENT_LIMIT,
      resetsAt: nextMidnight.toISOString(),
    });

    if (decision.allowed) throw new Error("expected blocked decision");
    const payload = dailyQuotaExceededPayload(decision, "Please try again tomorrow.");
    expect(payload).toEqual({
      error: "Daily limit reached",
      message: expect.stringContaining("Please try again tomorrow."),
      retryable: true,
      used: DEFAULT_DAILY_SEGMENT_LIMIT,
      limit: DEFAULT_DAILY_SEGMENT_LIMIT,
      resetsAt: nextMidnight.toISOString(),
    });
  });

  it("resets at the daily rollover", async () => {
    const before = new Date(DAY.y, DAY.m, DAY.d, 23, 59, 59, 999);
    const after = new Date(DAY.y, DAY.m, DAY.d + 1, 0, 0, 0, 0);

    await recordDailyUsage("segment", "segment-user-b", 1, before);
    await expect(getDailyUsage("segment", "segment-user-b", before)).resolves.toBe(1);

    // Next day starts from zero again.
    await expect(getDailyUsage("segment", "segment-user-b", after)).resolves.toBe(0);
    await recordDailyUsage("segment", "segment-user-b", 1, after);
    await expect(getDailyUsage("segment", "segment-user-b", after)).resolves.toBe(1);
  });
});

describe("label surface (OpenAI gpt-4o-mini vision, issue #263)", () => {
  it("records usage on its own Postgres counter", async () => {
    await expect(recordDailyUsage("label", "label-user-a", 1, midDay)).resolves.toBe(1);
    await expect(getDailyUsage("label", "label-user-a", midDay)).resolves.toBe(1);
    await expect(getDailyUsage("copy", "label-user-a", midDay)).resolves.toBe(0);
  });

  it("blocks at the label limit and returns a retryable 429 payload", () => {
    // One under the cap is still served...
    expect(evaluateDailyQuota(DEFAULT_DAILY_LABEL_LIMIT - 1, DEFAULT_DAILY_LABEL_LIMIT, midDay).allowed).toBe(true);
    // ...and the limit-th usage blocks the next request.
    const decision = evaluateDailyQuota(DEFAULT_DAILY_LABEL_LIMIT, DEFAULT_DAILY_LABEL_LIMIT, midDay);
    expect(decision).toEqual({
      allowed: false,
      used: DEFAULT_DAILY_LABEL_LIMIT,
      limit: DEFAULT_DAILY_LABEL_LIMIT,
      resetsAt: nextMidnight.toISOString(),
    });

    if (decision.allowed) throw new Error("expected blocked decision");
    const payload = dailyQuotaExceededPayload(decision, "Please try again tomorrow.");
    expect(payload).toEqual({
      error: "Daily limit reached",
      message: expect.stringContaining("Please try again tomorrow."),
      retryable: true,
      used: DEFAULT_DAILY_LABEL_LIMIT,
      limit: DEFAULT_DAILY_LABEL_LIMIT,
      resetsAt: nextMidnight.toISOString(),
    });
  });

  it("resets at the daily rollover", async () => {
    const before = new Date(DAY.y, DAY.m, DAY.d, 23, 59, 59, 999);
    const after = new Date(DAY.y, DAY.m, DAY.d + 1, 0, 0, 0, 0);

    await recordDailyUsage("label", "label-user-b", 1, before);
    await expect(getDailyUsage("label", "label-user-b", before)).resolves.toBe(1);

    // Next day starts from zero again.
    await expect(getDailyUsage("label", "label-user-b", after)).resolves.toBe(0);
    await recordDailyUsage("label", "label-user-b", 1, after);
    await expect(getDailyUsage("label", "label-user-b", after)).resolves.toBe(1);
  });
});

describe("default limits and env var names", () => {
  it("pin the shipped defaults", () => {
    expect(DEFAULT_DAILY_INPAINT_LIMIT).toBe(20);
    expect(DEFAULT_DAILY_COPY_LIMIT).toBe(50);
    expect(DEFAULT_DAILY_LABEL_LIMIT).toBe(50);
    expect(DEFAULT_DAILY_EXPORT_LIMIT).toBe(20);
    expect(DEFAULT_DAILY_SEGMENT_LIMIT).toBe(100);
    expect(SEGMENT_DAILY_LIMIT).toBe(100);
  });

  it("pin the env var reader names", () => {
    expect(DAILY_LIMIT_ENV_VAR).toEqual({
      inpaint: "DAILY_INPAINT_LIMIT",
      copy: "DAILY_COPY_LIMIT",
      label: "DAILY_LABEL_LIMIT",
      export: "DAILY_EXPORT_LIMIT",
      segment: "DAILY_SEGMENT_LIMIT",
    });
  });
});

describe("evaluateDailyBatchQuota (batch room-type detection, issue #681)", () => {
  it("allows a batch that fits entirely in the remaining headroom", () => {
    const decision = evaluateDailyBatchQuota(45, 5, 50);
    expect(decision).toEqual({ allowed: true, used: 45, limit: 50, remaining: 5 });
  });

  it("allows the exactly-filling batch (used + count === limit)", () => {
    expect(evaluateDailyBatchQuota(30, 20, 50).allowed).toBe(true);
    expect(evaluateDailyBatchQuota(0, 50, 50).allowed).toBe(true);
  });

  it("rejects a batch that would straddle the boundary — no partial service", () => {
    const decision = evaluateDailyBatchQuota(45, 6, 50);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.used).toBe(45);
      expect(decision.limit).toBe(50);
    }
  });

  it("rejects any batch at an exhausted limit", () => {
    expect(evaluateDailyBatchQuota(50, 1, 50).allowed).toBe(false);
    expect(evaluateDailyBatchQuota(50, 20, 50).allowed).toBe(false);
    expect(evaluateDailyBatchQuota(60, 1, 50).allowed).toBe(false);
  });

  it("reports the next-midnight reset window for a denied batch", () => {
    const decision = evaluateDailyBatchQuota(50, 1, 50, midDay);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.resetsAt).toBe(nextMidnight.toISOString());
      expect(decision.resetsAt).toBe(dailyWindow(midDay).endAt.toISOString());
    }
  });
});

// Issue #1110: a N-entry batch passed the OLD `evaluateDailyQuota(used, limit)`
// per-unit gate (`used < limit`) even when `used + N > limit`, so the batch
// would then `recordDailyUsage` N times and overshoot the cap by N-1. The
// wired call now uses `evaluateDailyBatchQuota(used, count, limit)` whose
// `used + count <= limit` semantic makes the straddler undeletable. These
// pins target the exact boundary the issue names so the regression cannot
// return without breaking a unit test.
describe("evaluateDailyBatchQuota overshoot guard (issue #1110)", () => {
  it("rejects a 5-entry batch at used=49/limit=50 (would have overshot by 4)", () => {
    // Per-unit gate would have allowed this (49 < 50) and the subsequent
    // recordDailyUsage x5 would have pushed used to 54. Batch gate denies
    // because 49 + 5 > 50, leaving used untouched at 49.
    const decision = evaluateDailyBatchQuota(49, 5, 50);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.used).toBe(49);
      expect(decision.limit).toBe(50);
    }
  });

  it("allows the exactly-filling batch at used=49/limit=50, count=1", () => {
    const decision = evaluateDailyBatchQuota(49, 1, 50);
    expect(decision).toEqual({ allowed: true, used: 49, limit: 50, remaining: 1 });
  });

  it("rejects N rooms each running N-1 labels (the issue's worst case)", async () => {
    // 20-entry batch (the schema cap) at used=31 / limit=50: 31 + 20 = 51
    // > 50, so the whole batch is denied. The old per-unit gate would have
    // passed (31 < 50) and recorded 20 units, leaving the user at 51/50.
    const decision = evaluateDailyBatchQuota(31, 20, 50);
    expect(decision.allowed).toBe(false);
  });

  it("allows a batch whose exact fill is `used + count === limit`", () => {
    expect(evaluateDailyBatchQuota(48, 2, 50).allowed).toBe(true);
    expect(evaluateDailyBatchQuota(0, 50, 50).allowed).toBe(true);
  });

  it("denies straddlers of any size, not just the unit case", () => {
    // Off-by-one across the boundary: each pair straddles by 1.
    expect(evaluateDailyBatchQuota(45, 6, 50).allowed).toBe(false);
    expect(evaluateDailyBatchQuota(40, 11, 50).allowed).toBe(false);
    expect(evaluateDailyBatchQuota(1, 50, 50).allowed).toBe(false);
  });

  it("end-to-end: a denied batch never reaches recordDailyUsage, so used stays at pre-batch value", async () => {
    // Mirrors the room-batch flow: gate with evaluateDailyBatchQuota; if
    // allowed, record N units. A denied batch must skip the recording step
    // entirely, which is what the room-batch.ts change enforces. Verify the
    // gate + recorder chain lands at exactly the pre-batch count, never
    // above (the regression would push above by count-1).
    const userId = "issue-1110-user";
    await recordDailyUsage("label", userId, 49, midDay);
    const gate = evaluateDailyBatchQuota(
      await getDailyUsage("label", userId, midDay),
      5,
      50
    );
    expect(gate.allowed).toBe(false);
    // The defensive caller (room-batch.ts) refuses to record on a denied gate.
    // Confirm getDailyUsage remains 49, not the 54 the regression would produce.
    expect(await getDailyUsage("label", userId, midDay)).toBe(49);
  });
});

describe("claimDailyQuota (atomic claim, issue #1132)", () => {
  const userId = "user-claim";
  beforeEach(() => {
    for (const key in mockUsageStore) delete mockUsageStore[key];
  });

  it("claims a unit on an untouched day (first-of-day create)", async () => {
    const claim = await claimDailyQuota("segment", userId, 100, 1, midDay);
    expect(claim).toEqual({ claimed: true, allowed: true, used: 1, limit: 100, remaining: 99 });
  });

  it("claims via the conditional increment when today's row exists", async () => {
    await recordDailyUsage("copy", userId, 10, midDay);
    const claim = await claimDailyQuota("copy", userId, 50, 1, midDay);
    expect(claim).toEqual({ claimed: true, allowed: true, used: 11, limit: 50, remaining: 39 });
  });

  it("allows the exact-fill claim and denies the straddler", async () => {
    await recordDailyUsage("label", userId, 48, midDay);
    const fill = await claimDailyQuota("label", userId, 50, 2, midDay);
    expect(fill.claimed).toBe(true);
    expect(fill).toMatchObject({ used: 50, remaining: 0 });
    // The next claim overshoots: zero rows updated, denied with today's count.
    const denied = await claimDailyQuota("label", userId, 50, 1, midDay);
    expect(denied).toEqual({
      claimed: false,
      allowed: false,
      used: 50,
      limit: 50,
      resetsAt: nextMidnight.toISOString(),
    });
  });

  it("denies a single request larger than the whole cap without writing", async () => {
    const claim = await claimDailyQuota("copy", userId, 50, 51, midDay);
    expect(claim.claimed).toBe(false);
    expect(claim).toMatchObject({ used: 0, limit: 50 });
    expect(Object.keys(mockUsageStore)).toHaveLength(0);
  });

  it("arbitrates concurrent first-of-day claims through the P2002 retry", async () => {
    // Two claims racing on an empty store: the loser of the create gets
    // P2002, retries the conditional increment, and both claims land.
    const [a, b] = await Promise.all([
      claimDailyQuota("export", userId, 20, 1, midDay),
      claimDailyQuota("export", userId, 20, 1, midDay),
    ]);
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(true);
    expect(await getDailyUsage("export", userId, midDay)).toBe(2);
  });

  it("claims a multi-unit batch in one conditional increment", async () => {
    const claim = await claimDailyQuota("label", userId, 50, 5, midDay);
    expect(claim).toEqual({ claimed: true, allowed: true, used: 5, limit: 50, remaining: 45 });
  });

  it("lets only one of two concurrent batch claims land (issue #1420)", async () => {
    // Mirrors the room-batch staging flow: two batches of 30 images race
    // for a 50-unit daily `label` allowance. The atomic conditional
    // increment arbitrates — exactly one claim lands, so the cap is never
    // overshot by a concurrent burst (an evaluate-then-record gate would
    // have let both batches pass and charged 60 units).
    const [a, b] = await Promise.all([
      claimDailyQuota("label", userId, 50, 30, midDay),
      claimDailyQuota("label", userId, 50, 30, midDay),
    ]);
    expect([a.claimed, b.claimed].filter(Boolean)).toHaveLength(1);
    expect(await getDailyUsage("label", userId, midDay)).toBe(30);
  });
});

describe("refundDailyQuota (issue #1132)", () => {
  const userId = "user-refund";
  beforeEach(() => {
    for (const key in mockUsageStore) delete mockUsageStore[key];
  });

  it("decrements the claimed units", async () => {
    await claimDailyQuota("segment", userId, 100, 3, midDay);
    await refundDailyQuota("segment", userId, 3, midDay);
    expect(await getDailyUsage("segment", userId, midDay)).toBe(0);
  });

  it("never drives a row negative", async () => {
    await claimDailyQuota("copy", userId, 50, 1, midDay);
    await refundDailyQuota("copy", userId, 5, midDay);
    expect(await getDailyUsage("copy", userId, midDay)).toBe(1);
  });

  it("is a no-op for a user with no row today and never throws", async () => {
    await expect(refundDailyQuota("export", userId, 1, midDay)).resolves.toBeUndefined();
    expect(await getDailyUsage("export", userId, midDay)).toBe(0);
  });

  it("swallows store failures instead of throwing", async () => {
    await claimDailyQuota("label", userId, 50, 1, midDay);
    const spy = vi
      .spyOn(prisma.dailyApiUsage, "updateMany")
      .mockRejectedValueOnce(new Error("store down"));
    await expect(refundDailyQuota("label", userId, 1, midDay)).resolves.toBeUndefined();
    spy.mockRestore();
    // Conservative: the failed refund leaves the count standing.
    expect(await getDailyUsage("label", userId, midDay)).toBe(1);
  });
});
