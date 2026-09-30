/**
 * Furnishings detection - partial mask failure (issue #1119)
 *
 * The mask downloads used to be aggregated with `Promise.all`, so one
 * slow or 5xx mask URL rejected the whole batch and the user got ZERO
 * regions after an already-billed SAM call. These pin the settle-per-mask
 * behaviour: successes survive a failing sibling, and only a total
 * failure takes the classified error path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(async () => ({ id: MOCK_USER_ID, email: "test@example.com" })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { room: { findFirst: vi.fn(async () => ({ id: MOCK_ROOM_ID })) } },
}));

const mockFalSubscribe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/fal", () => ({
  assertFalConfigured: vi.fn(),
  falSubscribeWithCircuitBreaker: mockFalSubscribe,
}));

const mockRecordDailyUsage = vi.hoisted(() => vi.fn(async () => 1));
vi.mock("@/lib/api-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-quota")>();
  return {
    ...actual,
    getDailyUsage: vi.fn(async () => 0),
    recordDailyUsage: mockRecordDailyUsage,
    resolveDailyLimit: vi.fn(() => 100),
  };
});

import { POST } from "@/app/api/segment/furnishings/route";

const MASK_URLS = [
  "https://v3.fal.ai/mask-0.png",
  "https://v3.fal.ai/mask-1.png",
  "https://v3.fal.ai/mask-2.png",
];

function buildRequest(): NextRequest {
  return {
    url: "http://localhost/api/segment/furnishings",
    json: async () => ({
      roomId: MOCK_ROOM_ID,
      imageUrl: "https://demo.supabase.co/storage/v1/object/public/room-photos/room.jpg",
      concept: "sofa",
    }),
  } as unknown as NextRequest;
}

function okMaskResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFalSubscribe.mockResolvedValue({
    masks: MASK_URLS.map((url, index) => ({ url, score: 0.9 - index / 10 })),
    scores: [0.9, 0.8, 0.7],
  });
});

describe("POST /api/segment/furnishings mask settling", () => {
  it("returns the masks that downloaded when one URL 500s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === MASK_URLS[1]
          ? new Response("upstream boom", { status: 500 })
          : okMaskResponse()
      )
    );

    const response = await POST(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.maskDataUrls).toHaveLength(2);
    expect(body.maskDataUrls.every((u: string) => u.startsWith("data:image/png;base64,"))).toBe(
      true
    );
    // Scores stay aligned with the masks that survived.
    expect(body.scores).toEqual([0.9, 0.7]);
    expect(mockRecordDailyUsage).toHaveBeenCalledTimes(1);
  });

  it("still succeeds when a mask fetch rejects outright", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === MASK_URLS[0]) throw new Error("socket hang up");
        return okMaskResponse();
      })
    );

    const response = await POST(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.maskDataUrls).toHaveLength(2);
  });

  it("takes the classified error path only when every mask fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    const response = await POST(buildRequest());
    const body = await response.json();

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(body.maskDataUrls).toBeUndefined();
  });

  it("keeps an empty detection a valid, billable result", async () => {
    mockFalSubscribe.mockResolvedValue({ masks: [], scores: [] });
    vi.stubGlobal("fetch", vi.fn(async () => okMaskResponse()));

    const response = await POST(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.maskDataUrls).toEqual([]);
    expect(mockRecordDailyUsage).toHaveBeenCalledTimes(1);
  });
});
