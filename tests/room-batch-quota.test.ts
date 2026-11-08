import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Issue #1420 — end-to-end proof that the room-batch staging action's
 * daily `label` quota handling is atomic and self-compensating.
 *
 * Unlike `tests/room-batch-action.test.ts` (which mocks the quota
 * helpers and asserts the CALLS), this file exercises the REAL
 * `claimDailyQuota` / `refundDailyQuota` implementations from
 * `@/lib/api-quota` against an in-memory `DailyApiUsage` store, so the
 * acceptance criterion "a failed batch does not consume the user's daily
 * allowance" is checked against the actual counter, not a mock.
 */

const mockUsageStore: Record<string, number> = {};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    dailyApiUsage: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const { userId, surface, dayKey } = where.userId_surface_dayKey;
        const key = `${userId}|${surface}|${dayKey}`;
        if (key in mockUsageStore) {
          mockUsageStore[key] += update?.count?.increment ?? 0;
        } else {
          mockUsageStore[key] = create?.count ?? 0;
        }
        return { count: mockUsageStore[key] };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
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
      create: vi.fn(async ({ data }: any) => {
        const key = `${data.userId}|${data.surface}|${data.dayKey}`;
        if (key in mockUsageStore) {
          throw new Prisma.PrismaClientKnownRequestError(
            "Unique constraint failed on the fields: (`userId`,`surface`,`dayKey`)",
            { code: "P2002", clientVersion: "5.22.0" }
          );
        }
        mockUsageStore[key] = data.count;
        return { count: mockUsageStore[key] };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const { userId, surface, dayKey } = where.userId_surface_dayKey;
        const key = `${userId}|${surface}|${dayKey}`;
        return key in mockUsageStore ? { count: mockUsageStore[key] } : null;
      }),
    },
  },
}));

const mockGetAuthedPrismaUser = vi.fn();
const mockRequireProjectOwnershipSafe = vi.fn();
const mockDetectRoomType = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: mockGetAuthedPrismaUser,
  requireProjectOwnershipSafe: mockRequireProjectOwnershipSafe,
}));

vi.mock("@/lib/room-type-detection", () => ({
  detectRoomType: mockDetectRoomType,
}));

const { detectBatchRoomTypes } = await import("@/app/actions/room-batch");
const { getDailyUsage } = await import("@/lib/api-quota");

const USER_ID = "user-room-batch-quota";
const PROJECT_ID = "project-1";
const LABEL_LIMIT = 3;

const url = (n: number) =>
  `https://room${n}.jpg.supabase.co/storage/v1/object/public/rooms/room${n}.jpg`;

describe("detectBatchRoomTypes daily quota accounting (issue #1420)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key in mockUsageStore) delete mockUsageStore[key];
    process.env.DAILY_LABEL_LIMIT = String(LABEL_LIMIT);
    mockGetAuthedPrismaUser.mockResolvedValue({ id: USER_ID });
    mockRequireProjectOwnershipSafe.mockResolvedValue({ project: { id: PROJECT_ID } });
  });

  it("does not consume the daily allowance when the batch fails", async () => {
    mockDetectRoomType.mockRejectedValue(new Error("upstream 503"));

    const result = await detectBatchRoomTypes(PROJECT_ID, [url(1), url(2)]);

    expect(result.success).toBe(false);
    // The claim was taken and then fully refunded: the user's allowance is
    // exactly what it was before the failed batch.
    expect(await getDailyUsage("label", USER_ID)).toBe(0);
  });

  it("does not consume the daily allowance when every image fails", async () => {
    mockDetectRoomType.mockRejectedValue(new Error("upstream 503"));

    const result = await detectBatchRoomTypes(PROJECT_ID, [url(1), url(2), url(3)]);

    expect(result.success).toBe(false);
    expect(await getDailyUsage("label", USER_ID)).toBe(0);
  });

  it("charges exactly one unit per successfully detected image", async () => {
    mockDetectRoomType.mockResolvedValue("Living Room");

    const result = await detectBatchRoomTypes(PROJECT_ID, [url(1), url(2)]);

    expect(result).toEqual({ success: true, roomTypes: ["Living Room", "Living Room"] });
    expect(await getDailyUsage("label", USER_ID)).toBe(2);
  });

  it("charges only the images that succeeded when part of the batch fails", async () => {
    mockDetectRoomType
      .mockResolvedValueOnce("Living Room")
      .mockRejectedValueOnce(new Error("upstream 503"))
      .mockResolvedValueOnce("Kitchen");

    const result = await detectBatchRoomTypes(PROJECT_ID, [url(1), url(2), url(3)]);

    expect(result).toEqual({
      success: true,
      roomTypes: ["Living Room", "Other", "Kitchen"],
    });
    // The failed image produced no room type, so its claimed unit is
    // refunded: only the two successful detections are charged.
    expect(await getDailyUsage("label", USER_ID)).toBe(2);
  });

  it("denies a batch that does not fit the remaining allowance without spending", async () => {
    mockDetectRoomType.mockResolvedValue("Living Room");

    const result = await detectBatchRoomTypes(PROJECT_ID, [url(1), url(2), url(3), url(4)]);

    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain("today's limit");
    // A denied claim writes nothing: no provider call, no counter move.
    expect(mockDetectRoomType).not.toHaveBeenCalled();
    expect(await getDailyUsage("label", USER_ID)).toBe(0);
  });

  it("lets only one of two concurrent batches claim the allowance", async () => {
    // Both batches ask for 2 units against a 3-unit daily allowance: only
    // one can land (the atomic conditional increment arbitrates), so the
    // cap is never overshot by a concurrent burst.
    mockDetectRoomType.mockResolvedValue("Living Room");

    const [a, b] = await Promise.all([
      detectBatchRoomTypes(PROJECT_ID, [url(1), url(2)]),
      detectBatchRoomTypes(PROJECT_ID, [url(3), url(4)]),
    ]);

    const successes = [a, b].filter((r) => r.success).length;
    expect(successes).toBe(1);
    expect(await getDailyUsage("label", USER_ID)).toBe(2);
  });
});
