import { describe, expect, it } from "vitest";

import {
  DEFAULT_DAILY_COPY_LIMIT,
  DEFAULT_DAILY_EXPORT_LIMIT,
  DEFAULT_DAILY_INPAINT_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  dailyQuotaExceededPayload,
  dailyWindow,
  evaluateDailyQuota,
  getDailyUsage,
  inpaintDailyUsageWhere,
  recordDailyUsage,
  resolveDailyLimit,
} from "@/lib/api-quota";

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

describe("in-process daily usage counter", () => {
  it("records billable units cumulatively and returns the new count", () => {
    expect(recordDailyUsage("copy", "counter-user-a", midDay)).toBe(1);
    expect(recordDailyUsage("copy", "counter-user-a", midDay)).toBe(2);
    expect(getDailyUsage("copy", "counter-user-a", midDay)).toBe(2);
  });

  it("isolates usage per user", () => {
    recordDailyUsage("export", "counter-user-b", midDay);
    expect(getDailyUsage("export", "counter-user-b", midDay)).toBe(1);
    expect(getDailyUsage("export", "counter-user-c", midDay)).toBe(0);
  });

  it("isolates usage per surface", () => {
    recordDailyUsage("copy", "counter-user-d", midDay);
    expect(getDailyUsage("copy", "counter-user-d", midDay)).toBe(1);
    expect(getDailyUsage("export", "counter-user-d", midDay)).toBe(0);
  });

  it("resets at the daily rollover and prunes previous-day keys", () => {
    const before = new Date(DAY.y, DAY.m, DAY.d, 23, 59, 59, 999);
    const after = new Date(DAY.y, DAY.m, DAY.d + 1, 0, 0, 0, 0);

    recordDailyUsage("copy", "counter-user-e", before);
    recordDailyUsage("copy", "counter-user-e", before);
    expect(getDailyUsage("copy", "counter-user-e", before)).toBe(2);

    // Next day starts from zero...
    expect(getDailyUsage("copy", "counter-user-e", after)).toBe(0);
    recordDailyUsage("copy", "counter-user-e", after);
    expect(getDailyUsage("copy", "counter-user-e", after)).toBe(1);

    // ...and the previous day's key was pruned by the day-2 write.
    expect(getDailyUsage("copy", "counter-user-e", before)).toBe(0);
  });

  it("treats an unknown user as zero usage", () => {
    expect(getDailyUsage("copy", "counter-user-nobody", midDay)).toBe(0);
  });
});

describe("default limits and env var names", () => {
  it("pin the shipped defaults", () => {
    expect(DEFAULT_DAILY_INPAINT_LIMIT).toBe(20);
    expect(DEFAULT_DAILY_COPY_LIMIT).toBe(50);
    expect(DEFAULT_DAILY_EXPORT_LIMIT).toBe(20);
  });

  it("pin the env var reader names", () => {
    expect(DAILY_LIMIT_ENV_VAR).toEqual({
      inpaint: "DAILY_INPAINT_LIMIT",
      copy: "DAILY_COPY_LIMIT",
      export: "DAILY_EXPORT_LIMIT",
    });
  });
});
