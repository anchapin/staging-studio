import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkRateLimit,
  recordRateLimit,
  clearRateLimit,
  checkAndRecordRateLimit,
} from "@/lib/sliding-window-ratelimit";
import { prisma } from "@/lib/prisma";

const USER_ID = "user_123";
const SURFACE = "test";
const IDENTIFIER = `${SURFACE}:${USER_ID}`;
const LIMIT = 5;
const WINDOW_MS = 60_000;

async function getRecord() {
  const { dayKey } = dailyWindow();
  return prisma.dailyApiUsage.findUnique({
    where: {
      userId_surface_dayKey: {
        userId: USER_ID,
        surface: SURFACE,
        dayKey,
      },
    },
  });
}

function dailyWindow(now: Date = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const startAt = new Date(year, month, day, 0, 0, 0, 0);
  const endAt = new Date(year, month, day + 1, 0, 0, 0, 0);
  const dayKey = [
    String(year).padStart(4, "0"),
    String(month + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
  return { dayKey, startAt, endAt };
}

describe("sliding-window-ratelimit", () => {
  beforeEach(async () => {
    const { dayKey } = dailyWindow();
    await prisma.dailyApiUsage.deleteMany({
      where: { userId: USER_ID, surface: SURFACE, dayKey },
    });
  });

  afterEach(async () => {
    const { dayKey } = dailyWindow();
    await prisma.dailyApiUsage.deleteMany({
      where: { userId: USER_ID, surface: SURFACE, dayKey },
    });
  });

  describe("checkRateLimit", () => {
    it("allows first request when no record exists", async () => {
      const result = await checkRateLimit(IDENTIFIER, LIMIT, WINDOW_MS);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1);
    });

    it("returns correct remaining after some requests", async () => {
      const now = new Date();
      await prisma.dailyApiUsage.create({
        data: {
          userId: USER_ID,
          surface: SURFACE,
          dayKey: dailyWindow(now).dayKey,
          count: 3,
          timestamps: [
            new Date(now.getTime() - 30000),
            new Date(now.getTime() - 20000),
            new Date(now.getTime() - 10000),
          ],
        },
      });

      const result = await checkRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 3);
    });

    it("blocks when limit is reached within window", async () => {
      const now = new Date();
      await prisma.dailyApiUsage.create({
        data: {
          userId: USER_ID,
          surface: SURFACE,
          dayKey: dailyWindow(now).dayKey,
          count: LIMIT,
          timestamps: Array.from({ length: LIMIT }, (_, i) => new Date(now.getTime() - (LIMIT - i) * 1000)),
        },
      });

      const result = await checkRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("allows request after window expires", async () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - WINDOW_MS - 1000);
      await prisma.dailyApiUsage.create({
        data: {
          userId: USER_ID,
          surface: SURFACE,
          dayKey: dailyWindow(now).dayKey,
          count: LIMIT,
          timestamps: [oldTimestamp],
        },
      });

      const result = await checkRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);
      expect(result.allowed).toBe(true);
    });

    it("cleans up expired timestamps on check", async () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - WINDOW_MS - 1000);
      await prisma.dailyApiUsage.create({
        data: {
          userId: USER_ID,
          surface: SURFACE,
          dayKey: dailyWindow(now).dayKey,
          count: LIMIT,
          timestamps: [oldTimestamp],
        },
      });

      await checkRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);

      const record = await getRecord();
      expect(record?.count).toBe(0);
      expect(record?.timestamps).toEqual([]);
    });
  });

  describe("recordRateLimit", () => {
    it("creates record on first request", async () => {
      const now = new Date();
      const result = await recordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1);

      const record = await getRecord();
      expect(record?.count).toBe(1);
      expect(record?.timestamps).toHaveLength(1);
    });

    it("increments count and adds timestamp", async () => {
      const now = new Date();
      await recordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);
      await recordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);

      const record = await getRecord();
      expect(record?.count).toBe(2);
      expect(record?.timestamps).toHaveLength(2);
    });

    it("blocks when limit is exceeded", async () => {
      const now = new Date();
      await prisma.dailyApiUsage.create({
        data: {
          userId: USER_ID,
          surface: SURFACE,
          dayKey: dailyWindow(now).dayKey,
          count: LIMIT,
          timestamps: Array.from({ length: LIMIT }, (_, i) => new Date(now.getTime() - (LIMIT - i) * 1000)),
        },
      });

      const result = await recordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("only counts timestamps within window", async () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - WINDOW_MS - 1000);
      await prisma.dailyApiUsage.create({
        data: {
          userId: USER_ID,
          surface: SURFACE,
          dayKey: dailyWindow(now).dayKey,
          count: 1,
          timestamps: [oldTimestamp],
        },
      });

      const result = await recordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1);

      const record = await getRecord();
      expect(record?.count).toBe(1);
      expect(record?.timestamps).toHaveLength(1);
    });
  });

  describe("clearRateLimit", () => {
    it("deletes the record for identifier", async () => {
      const now = new Date();
      await prisma.dailyApiUsage.create({
        data: {
          userId: USER_ID,
          surface: SURFACE,
          dayKey: dailyWindow(now).dayKey,
          count: 3,
          timestamps: [now],
        },
      });

      await clearRateLimit(IDENTIFIER);

      const record = await getRecord();
      expect(record).toBeNull();
    });
  });

  describe("checkAndRecordRateLimit", () => {
    it("checks and records atomically", async () => {
      const now = new Date();
      const result = await checkAndRecordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1);

      const record = await getRecord();
      expect(record?.count).toBe(1);
    });

    it("returns not allowed without recording when limit exceeded", async () => {
      const now = new Date();
      await prisma.dailyApiUsage.create({
        data: {
          userId: USER_ID,
          surface: SURFACE,
          dayKey: dailyWindow(now).dayKey,
          count: LIMIT,
          timestamps: Array.from({ length: LIMIT }, (_, i) => new Date(now.getTime() - (LIMIT - i) * 1000)),
        },
      });

      const result = await checkAndRecordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);

      const record = await getRecord();
      expect(record?.count).toBe(LIMIT);
    });
  });

  describe("identifier parsing", () => {
    it("handles surface:userId format", async () => {
      const identifier = "copy:user_abc";
      const now = new Date();

      const result = await checkRateLimit(identifier, LIMIT, WINDOW_MS, now);
      expect(result.allowed).toBe(true);

      await recordRateLimit(identifier, LIMIT, WINDOW_MS, now);

      const record = await prisma.dailyApiUsage.findUnique({
        where: {
          userId_surface_dayKey: {
            userId: "user_abc",
            surface: "copy",
            dayKey: dailyWindow(now).dayKey,
          },
        },
      });
      expect(record).not.toBeNull();
      expect(record?.userId).toBe("user_abc");
      expect(record?.surface).toBe("copy");
    });
  });

  describe("window semantics", () => {
    it("resets at midnight", async () => {
      const now = new Date();
      const { dayKey: todayKey } = dailyWindow(now);

      await recordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);
      const record = await getRecord();
      expect(record?.dayKey).toBe(todayKey);
      expect(record?.count).toBe(1);
    });

    it("resetAt is next midnight", async () => {
      const now = new Date();
      const { endAt } = dailyWindow(now);

      const result = await checkRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);
      expect(result.resetAt).toBe(endAt.getTime());
    });
  });
});
