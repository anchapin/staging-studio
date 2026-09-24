import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { NextRequest } from "next/server";

import { POST } from "@/app/api/inpaint/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { evaluateInpaintQualityGate } from "@/lib/inpaint-quality-gate";
import { fal } from "@/lib/fal";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/fal", () => ({
  fal: { queue: { submit: vi.fn() } },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: { findFirst: vi.fn() },
    inpaintRequest: { count: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/inpaint-quality-gate", () => ({
  evaluateInpaintQualityGate: vi.fn(),
}));

const falQueueSubmit = fal.queue.submit as unknown as Mock;
const create = prisma.inpaintRequest.create as unknown as Mock;
const findFirst = prisma.room.findFirst as unknown as Mock;
const count = prisma.inpaintRequest.count as unknown as Mock;
const authedUser = getAuthedPrismaUser as unknown as Mock;
const qualityGate = evaluateInpaintQualityGate as unknown as Mock;

const USER_ID = "user-1";
const ROOM_ID = "room-1";
const REQUEST_ID = "req-1";

const VALID_BODY = {
  imageUrl: "https://example.supabase.co/storage/v1/object/public/staging-images/before.png",
  maskUrl: "data:image/png;base64,BBB",
  promptDirectives: "Brighten the room, add warm neutrals",
  aesthetic: "Modern",
  roomId: ROOM_ID,
  variantSlot: 0,
  sourceSlot: null,
};

const EXPECTED_RECORD_DATA = {
  id: REQUEST_ID,
  roomId: ROOM_ID,
  variantSlot: 0,
  sourceSlot: null,
  status: "IN_QUEUE",
};

async function callSubmitRoute(): Promise<Response> {
  const request = new Request("http://localhost/api/inpaint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(VALID_BODY),
  });
  return POST(request as unknown as NextRequest);
}

beforeEach(() => {
  vi.resetAllMocks();
  authedUser.mockResolvedValue({ id: USER_ID });
  count.mockResolvedValue(0);
  findFirst.mockResolvedValue({
    id: ROOM_ID,
    name: "Living Room",
    afterImageUrl: null,
    afterImageUrl2: null,
  });
  qualityGate.mockResolvedValue([]);
  falQueueSubmit.mockResolvedValue({ request_id: REQUEST_ID });
  create.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/inpaint — InpaintRequest create compensation (issue #688)", () => {
  it("compensates a one-shot create failure: one billed fal submit, row created, no degraded flag", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    create
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValue({});

    const response = await callSubmitRoute();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requestId).toBe(REQUEST_ID);
    expect(body.degraded).toBeUndefined();
    // Exactly one billed fal run — the retry must never re-submit.
    expect(falQueueSubmit).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, { data: EXPECTED_RECORD_DATA });
    expect(create).toHaveBeenNthCalledWith(2, { data: EXPECTED_RECORD_DATA });
    expect(
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("inpaint_record_create_retry")
      )
    ).toBe(true);
  });

  it("returns degraded:true with the requestId after all create attempts fail", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValue(new Error("db down"));

    const response = await callSubmitRoute();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requestId).toBe(REQUEST_ID);
    expect(body.degraded).toBe(true);
    expect(body.qualityWarnings).toEqual([]);
    // Still exactly one billed fal run — a 500 here is what caused the
    // duplicate paid re-submit.
    expect(falQueueSubmit).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(3);
    expect(
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("inpaint_record_create_failed")
      )
    ).toBe(true);
  });

  it("does not retry when the create succeeds on the first attempt", async () => {
    const response = await callSubmitRoute();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ requestId: REQUEST_ID, qualityWarnings: [] });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ data: EXPECTED_RECORD_DATA });
  });
});
