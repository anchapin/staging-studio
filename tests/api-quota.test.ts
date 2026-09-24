import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DAILY_COPY_LIMIT,
  DEFAULT_DAILY_EXPORT_LIMIT,
  DEFAULT_DAILY_INPAINT_LIMIT,
  DEFAULT_DAILY_LABEL_LIMIT,
  DEFAULT_DAILY_SEGMENT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  SEGMENT_DAILY_LIMIT,
  dailyQuotaExceededPayload,
  dailyWindow,
  evaluateDailyBatchQuota,
  evaluateDailyQuota,
  getDailyUsage,
  inpaintDailyUsageWhere,
  recordDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";

// Shared in-memory store for mock api-quota functions (reset between tests)
const mockUsageStore: Record<string, number> = {};

vi.mock("@/lib/api-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-quota")>();
  return {
    ...actual,
    recordDailyUsage: vi.fn(async (surface: string, userId: string, now: Date) => {
      const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const key = `${userId}:${surface}:${dayKey}`;
      // Prune previous day's entries for this user+surface (simulates old in-process Map behavior)
      for (const k of Object.keys(mockUsageStore)) {
        if (k.startsWith(`${userId}:${surface}:`) && !k.endsWith(`:${dayKey}`)) {
          delete mockUsageStore[k];
        }
      }
      mockUsageStore[key] = (mockUsageStore[key] ?? 0) + 1;
      return mockUsageStore[key];
    }),
    getDailyUsage: vi.fn(async (surface: string, userId: string, now: Date) => {
      const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const key = `${userId}:${surface}:${dayKey}`;
      return mockUsageStore[key] ?? 0;
    }),
  };
});

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

describe("inpaintDailyUsageWhere", () => {
  it("scopes the count to the user's rooms within the daily window", () => {
    const where = inpaintDailyUsageWhere("user_1", midDay);
    expect(where).toEqual({
      room: { project: { userId: "user_1" } },
      createdAt: { gte: new Date(DAY.y, DAY.m, DAY.d, 0, 0, 0, 0) },
    });
  });
});

beforeEach(() => {
  // Clear the shared in-memory store between tests
  for (const key in mockUsageStore) delete mockUsageStore[key];
});

describe("in-process daily usage counter", () => {
  it("records billable units cumulatively and returns the new count", async () => {
    await expect(recordDailyUsage("copy", "counter-user-a", midDay)).resolves.toBe(1);
    await expect(recordDailyUsage("copy", "counter-user-a", midDay)).resolves.toBe(2);
    await expect(getDailyUsage("copy", "counter-user-a", midDay)).resolves.toBe(2);
  });

  it("isolates usage per user", async () => {
    await recordDailyUsage("export", "counter-user-b", midDay);
    await expect(getDailyUsage("export", "counter-user-b", midDay)).resolves.toBe(1);
    await expect(getDailyUsage("export", "counter-user-c", midDay)).resolves.toBe(0);
  });

  it("isolates usage per surface", async () => {
    await recordDailyUsage("copy", "counter-user-d", midDay);
    await expect(getDailyUsage("copy", "counter-user-d", midDay)).resolves.toBe(1);
    await expect(getDailyUsage("export", "counter-user-d", midDay)).resolves.toBe(0);
  });

  it("resets at the daily rollover and prunes previous-day keys", async () => {
    const before = new Date(DAY.y, DAY.m, DAY.d, 23, 59, 59, 999);
    const after = new Date(DAY.y, DAY.m, DAY.d + 1, 0, 0, 0, 0);

    await recordDailyUsage("copy", "counter-user-e", before);
    await recordDailyUsage("copy", "counter-user-e", before);
    await expect(getDailyUsage("copy", "counter-user-e", before)).resolves.toBe(2);

    // Next day starts from zero...
    await expect(getDailyUsage("copy", "counter-user-e", after)).resolves.toBe(0);
    await recordDailyUsage("copy", "counter-user-e", after);
    await expect(getDailyUsage("copy", "counter-user-e", after)).resolves.toBe(1);

    // ...and the previous day's key was pruned by the day-2 write.
    await expect(getDailyUsage("copy", "counter-user-e", before)).resolves.toBe(0);
  });

  it("treats an unknown user as zero usage", async () => {
    await expect(getDailyUsage("copy", "counter-user-nobody", midDay)).resolves.toBe(0);
  });
});

describe("segment surface (SAM 3.1 concept calls, issue #226)", () => {
  it("records usage on its own in-process counter", async () => {
    await expect(recordDailyUsage("segment", "segment-user-a", midDay)).resolves.toBe(1);
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

    await recordDailyUsage("segment", "segment-user-b", before);
    await expect(getDailyUsage("segment", "segment-user-b", before)).resolves.toBe(1);

    // Next day starts from zero again.
    await expect(getDailyUsage("segment", "segment-user-b", after)).resolves.toBe(0);
    await recordDailyUsage("segment", "segment-user-b", after);
    await expect(getDailyUsage("segment", "segment-user-b", after)).resolves.toBe(1);
  });
});

describe("label surface (OpenAI gpt-4o-mini vision, issue #263)", () => {
  it("records usage on its own in-process counter", async () => {
    await expect(recordDailyUsage("label", "label-user-a", midDay)).resolves.toBe(1);
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

    await recordDailyUsage("label", "label-user-b", before);
    await expect(getDailyUsage("label", "label-user-b", before)).resolves.toBe(1);

    // Next day starts from zero again.
    await expect(getDailyUsage("label", "label-user-b", after)).resolves.toBe(0);
    await recordDailyUsage("label", "label-user-b", after);
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
