import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  recordRateLimit,
  clearRateLimit,
  checkAndRecordRateLimit,
} from "@/lib/sliding-window-ratelimit";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyApiUsage: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const mockFindUnique = vi.mocked(prisma.dailyApiUsage.findUnique);
const mockCreate = vi.mocked(prisma.dailyApiUsage.create);
const mockUpdate = vi.mocked(prisma.dailyApiUsage.update);
const mockDeleteMany = vi.mocked(prisma.dailyApiUsage.deleteMany);

const USER_ID = "user_123";
const SURFACE = "test";
const IDENTIFIER = `${SURFACE}:${USER_ID}`;
const LIMIT = 5;
const WINDOW_MS = 60_000;

function todayDayKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  return [
    String(year).padStart(4, "0"),
    String(month + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function buildRecord(overrides: Partial<{
  count: number;
  timestamps: Date[];
  dayKey: string;
}> = {}) {
  return {
    id: "mock_id_123",
    userId: USER_ID,
    surface: SURFACE,
    dayKey: overrides.dayKey ?? todayDayKey(),
    count: overrides.count ?? 0,
    timestamps: overrides.timestamps ?? [],
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

describe("sliding-window-ratelimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkRateLimit", () => {
    it("allows first request when no record exists", async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await checkRateLimit(IDENTIFIER, LIMIT, WINDOW_MS);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1);
    });

    it("returns remaining based on prior count", async () => {
      const now = new Date();
      mockFindUnique.mockResolvedValue(
        buildRecord({
          count: 3,
          timestamps: [
            new Date(now.getTime() - 30000),
            new Date(now.getTime() - 20000),
            new Date(now.getTime() - 10000),
          ],
        })
      );

      const result = await checkRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);
      expect(result.remaining).toBe(0);
    });

    it("blocks when limit is reached within window", async () => {
      const now = new Date();
      const timestamps = Array.from(
        { length: LIMIT },
        (_, i) => new Date(now.getTime() - (LIMIT - i) * 1000)
      );
      mockFindUnique.mockResolvedValue(
        buildRecord({ count: LIMIT, timestamps })
      );

      const result = await checkRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("allows request after window expires", async () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - WINDOW_MS - 1000);
      mockFindUnique.mockResolvedValue(
        buildRecord({ count: LIMIT, timestamps: [oldTimestamp] })
      );

      const result = await checkRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);
      expect(result.allowed).toBe(true);
    });

    it("cleans up expired timestamps on check", async () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - WINDOW_MS - 1000);
      mockFindUnique.mockResolvedValue(
        buildRecord({ count: LIMIT, timestamps: [oldTimestamp] })
      );
      mockUpdate.mockResolvedValue(buildRecord({ count: 0, timestamps: [] }));

      await checkRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: {
          userId_surface_dayKey: {
            userId: USER_ID,
            surface: SURFACE,
            dayKey: todayDayKey(now),
          },
        },
        data: {
          timestamps: [],
          count: 0,
        },
      });
    });
  });

  describe("recordRateLimit", () => {
    it("creates record on first request", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockResolvedValue(buildRecord({ count: 1 }));

      const now = new Date();
      const result = await recordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1);
      expect(mockCreate).toHaveBeenCalled();
    });

    it("increments count and adds timestamp when under limit", async () => {
      const now = new Date();
      mockFindUnique.mockResolvedValue(
        buildRecord({
          count: 1,
          timestamps: [new Date(now.getTime() - 10000)],
        })
      );
      mockUpdate.mockResolvedValue(buildRecord({ count: 2 }));

      await recordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);

      expect(mockUpdate).toHaveBeenCalled();
    });

    it("blocks and does not record when limit exceeded", async () => {
      const now = new Date();
      const timestamps = Array.from(
        { length: LIMIT },
        (_, i) => new Date(now.getTime() - (LIMIT - i) * 1000)
      );
      mockFindUnique.mockResolvedValue(buildRecord({ count: LIMIT, timestamps }));

      const result = await recordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe("clearRateLimit", () => {
    it("deletes the record for identifier", async () => {
      mockDeleteMany.mockResolvedValue({ count: 1 });

      await clearRateLimit(IDENTIFIER);

      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          surface: SURFACE,
          dayKey: expect.any(String),
        },
      });
    });
  });

  describe("checkAndRecordRateLimit", () => {
    it("allows and records when under limit", async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockResolvedValue(buildRecord({ count: 1 }));

      const now = new Date();
      const result = await checkAndRecordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(LIMIT - 1);
      expect(mockCreate).toHaveBeenCalled();
    });

    it("blocks and does not record when at limit", async () => {
      const now = new Date();
      const timestamps = Array.from(
        { length: LIMIT },
        (_, i) => new Date(now.getTime() - (LIMIT - i) * 1000)
      );
      mockFindUnique.mockResolvedValue(buildRecord({ count: LIMIT, timestamps }));

      const result = await checkAndRecordRateLimit(IDENTIFIER, LIMIT, WINDOW_MS, now);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
