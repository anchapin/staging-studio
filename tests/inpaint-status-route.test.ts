import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextRequest } from "next/server";

import { GET } from "@/app/api/inpaint/[requestId]/status/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { fal } from "@/lib/fal";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/fal", () => ({
  fal: { queue: { status: vi.fn(), result: vi.fn() } },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inpaintRequest: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(),
}));

const falQueueStatus = fal.queue.status as unknown as Mock;
const findUnique = prisma.inpaintRequest.findUnique as unknown as Mock;
const update = prisma.inpaintRequest.update as unknown as Mock;
const authedUser = getAuthedPrismaUser as unknown as Mock;

const USER_ID = "user-1";
const REQUEST_ID = "req-1";

/** An owned, in-flight InpaintRequest row (the happy polling path). */
function ownedRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "IN_PROGRESS",
    resultUrl: null,
    room: { project: { userId: USER_ID } },
    ...overrides,
  };
}

async function callStatusRoute(): Promise<Response> {
  const request = new Request(
    `http://localhost/api/inpaint/${REQUEST_ID}/status`
  );
  return GET(request as unknown as NextRequest, {
    params: Promise.resolve({ requestId: REQUEST_ID }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  authedUser.mockResolvedValue({ id: USER_ID });
  findUnique.mockResolvedValue(ownedRow());
  update.mockResolvedValue({});
});

describe("GET /api/inpaint/[requestId]/status — fal ERROR terminal state (issue #686)", () => {
  it("persists ERROR to the row and responds with a terminal payload", async () => {
    falQueueStatus.mockResolvedValue({ status: "ERROR" });

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      status: "ERROR",
      error: "Inpainting failed",
      message: "The image editing process encountered an error. Please try again.",
      retryable: false,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: REQUEST_ID },
      data: { status: "ERROR" },
    });
  });

  it("still responds terminal when the row update fails (best-effort persist)", async () => {
    falQueueStatus.mockResolvedValue({ status: "ERROR" });
    update.mockRejectedValue(new Error("db down"));

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.status).toBe("ERROR");
    expect(body.retryable).toBe(false);
  });

  it("returns the terminal payload immediately without calling fal when the row is already ERROR", async () => {
    findUnique.mockResolvedValue(ownedRow({ status: "ERROR" }));

    const response = await callStatusRoute();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      status: "ERROR",
      error: "Inpainting failed",
      message: "The image editing process encountered an error. Please try again.",
      retryable: false,
    });
    expect(falQueueStatus).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
