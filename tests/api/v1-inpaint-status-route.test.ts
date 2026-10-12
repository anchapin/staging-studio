import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextRequest } from "next/server";

import { GET } from "@/app/api/v1/inpaint/[requestId]/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

// Issue #1123: the v1 inpaint status route skipped the unversioned twin's
// 10/min poll cap entirely, making it the one unbounded path to the fal
// queue. These tests pin the new Postgres-backed rate-limit branch and the
// pass-through to the stub response.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyApiUsage: {
      findUnique: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    inpaintRequest: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

const findDaily = prisma.dailyApiUsage.findUnique as unknown as Mock;
const findRequest = prisma.inpaintRequest.findFirst as unknown as Mock;
const authedUser = getAuthedPrismaUser as unknown as Mock;

const USER_ID = "user-1";
const REQUEST_ID = "req-1";

function callRoute(): Promise<Response> {
  const request = new Request(`http://localhost/api/v1/inpaint/${REQUEST_ID}`);
  return GET(request as unknown as NextRequest, {
    params: Promise.resolve({ requestId: REQUEST_ID }),
  });
}

function dailyRow(recentCount: number) {
  const now = Date.now();
  return {
    userId: `${USER_ID}:${REQUEST_ID}`,
    surface: "inpaint-status",
    dayKey: "2026-10-12",
    count: recentCount,
    timestamps: Array.from({ length: recentCount }, () => new Date(now - 1_000)),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  authedUser.mockResolvedValue({ id: USER_ID });
});

describe("GET /api/v1/inpaint/[requestId] — poll rate limit (issue #1123)", () => {
  it("returns 429 when 10 recent polls exist, with Retry-After and v1 headers", async () => {
    findDaily.mockResolvedValue(dailyRow(10));

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("Too many requests");
    expect(body.retryable).toBe(true);
    expect(body.code).toBe("too-many-requests");
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(58);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("X-Supabase-API-Version")).toBe("v1");
  });

  it("allows the poll and answers the stub when under the cap", async () => {
    findRequest.mockResolvedValue({ id: REQUEST_ID });

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toContain("stub");
    expect(response.headers.get("X-Supabase-API-Version")).toBe("v1");
  });

  it("the 429 fires before the daily-quota read", async () => {
    findDaily.mockImplementation(async ({ where }: { where: { userId_surface_dayKey: { surface: string } } }) => {
      const surface = where.userId_surface_dayKey.surface;
      if (surface === "inpaint-status") return dailyRow(10);
      return { count: 0 }; // daily-quota surface would be fine
    });

    const response = await callRoute();
    expect(response.status).toBe(429);
  });
});
