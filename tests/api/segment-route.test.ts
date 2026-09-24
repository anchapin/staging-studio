import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/segment/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { fal } from "@/lib/fal";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";

const mockUser = { id: MOCK_USER_ID, email: "test@example.com", name: "Test User" };

function buildRequest(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/fal", () => ({
  fal: {
    subscribe: vi.fn(),
  },
  assertFalConfigured: vi.fn(),
}));

describe("POST /api/segment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: MOCK_ROOM_ID });
  });

  it("retries on CDN 500 error and succeeds on retry", async () => {
    const mockMaskUrl = "https://cdn.example.com/mask.png";
    let callCount = 0;

    vi.mocked(fal.subscribe).mockImplementation(
      async () =>
        ({
          image: { url: mockMaskUrl },
        }) as unknown as Awaited<ReturnType<(typeof fal)["subscribe"]>>
    );

    const originalFetch = global.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 500,
            headers: new Map([["content-type", "image/png"]]),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "image/png"]]),
          arrayBuffer: async () => new ArrayBuffer(8),
        } as unknown as Response;
      })
    );

    const request = buildRequest({
      roomId: MOCK_ROOM_ID,
      imageUrl: "https://example.com/image.png",
      point: { x: 100, y: 200 },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Cleanup
    vi.stubGlobal("fetch", originalFetch);
  });

  it("retries on CDN 502 error and succeeds on retry", async () => {
    const mockMaskUrl = "https://cdn.example.com/mask.png";
    let callCount = 0;

    vi.mocked(fal.subscribe).mockImplementation(
      async () =>
        ({
          image: { url: mockMaskUrl },
        }) as unknown as Awaited<ReturnType<(typeof fal)["subscribe"]>>
    );

    const originalFetch = global.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 502,
            headers: new Map([["content-type", "image/png"]]),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "image/png"]]),
          arrayBuffer: async () => new ArrayBuffer(8),
        } as unknown as Response;
      })
    );

    const request = buildRequest({
      roomId: MOCK_ROOM_ID,
      imageUrl: "https://example.com/image.png",
      point: { x: 100, y: 200 },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    vi.stubGlobal("fetch", originalFetch);
  });

  it("retries on network error and succeeds on retry", async () => {
    const mockMaskUrl = "https://cdn.example.com/mask.png";
    let callCount = 0;

    vi.mocked(fal.subscribe).mockImplementation(
      async () =>
        ({
          image: { url: mockMaskUrl },
        }) as unknown as Awaited<ReturnType<(typeof fal)["subscribe"]>>
    );

    const originalFetch = global.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Network error");
        }
        return {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "image/png"]]),
          arrayBuffer: async () => new ArrayBuffer(8),
        } as unknown as Response;
      })
    );

    const request = buildRequest({
      roomId: MOCK_ROOM_ID,
      imageUrl: "https://example.com/image.png",
      point: { x: 100, y: 200 },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    vi.stubGlobal("fetch", originalFetch);
  });

  it("fails after max retries on persistent CDN error", async () => {
    const mockMaskUrl = "https://cdn.example.com/mask.png";

    vi.mocked(fal.subscribe).mockImplementation(
      async () =>
        ({
          image: { url: mockMaskUrl },
        }) as unknown as Awaited<ReturnType<(typeof fal)["subscribe"]>>
    );

    const originalFetch = global.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Map([["content-type", "image/png"]]),
      } as unknown as Response)
    );

    const request = buildRequest({
      roomId: MOCK_ROOM_ID,
      imageUrl: "https://example.com/image.png",
      point: { x: 100, y: 200 },
    });

    const response = await POST(request);
    const json = await response.json();
    expect(response.status).toBe(500);
    expect(json.error).toBe("Segmentation failed");

    vi.stubGlobal("fetch", originalFetch);
  });

  it("fails after max retries on persistent network error", async () => {
    const mockMaskUrl = "https://cdn.example.com/mask.png";

    vi.mocked(fal.subscribe).mockImplementation(
      async () =>
        ({
          image: { url: mockMaskUrl },
        }) as unknown as Awaited<ReturnType<(typeof fal)["subscribe"]>>
    );

    const originalFetch = global.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Persistent network error"))
    );

    const request = buildRequest({
      roomId: MOCK_ROOM_ID,
      imageUrl: "https://example.com/image.png",
      point: { x: 100, y: 200 },
    });

    const response = await POST(request);
    const json = await response.json();
    expect(response.status).toBe(500);

    vi.stubGlobal("fetch", originalFetch);
  });
});
