/**
 * Inpaint Status Route - Behavior Tests
 *
 * Tests the GET /api/inpaint/[requestId]/status endpoint.
 * Behaviors tested based on actual route implementation:
 * - 401 when unauthenticated
 * - 429 when rate limited
 * - 404 when request not found
 * - 404 when request belongs to different user
 * - Returns completed with stored resultUrl when status=COMPLETED with resultUrl
 * - Returns in-progress when status=PROCESSING (triggers fal poll)
 * - Handles fal COMPLETED (downloads and persists image)
 * - Returns 500 when fal returns ERROR
 * - Returns 500 on unexpected errors
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "@/app/api/inpaint/[requestId]/status/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { slidingWindowRateLimit } from "@/lib/sliding-window-ratelimit";
import { decideInpaintPersistence } from "@/lib/inpaint-persistence";
import { classifyIntegrationError } from "@/lib/error-classify";
import { fal } from "@/lib/fal";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_REQUEST_ID = "creq12345678901234567890";

const mockUser = { id: MOCK_USER_ID, email: "test@example.com", name: "Test User" };

function buildRequest(): NextRequest {
  return {
    json: async () => ({}),
  } as unknown as NextRequest;
}

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inpaintRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/fal", () => ({
  fal: {
    queue: {
      status: vi.fn(),
      result: vi.fn(),
    },
  },
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        getPublicUrl: vi.fn(),
      })),
    },
  })),
}));

vi.mock("@/lib/inpaint-persistence", () => ({
  decideInpaintPersistence: vi.fn(),
}));

vi.mock("@/lib/error-classify", () => ({
  classifyIntegrationError: vi.fn(),
}));

vi.mock("@/lib/sliding-window-ratelimit", () => ({
  slidingWindowRateLimit: vi.fn(),
}));

describe("GET /api/inpaint/[requestId]/status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(slidingWindowRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 59,
      limit: 60,
      resetsAt: new Date(Date.now() + 60_000),
    });
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const response = await GET(buildRequest(), { params: Promise.resolve({ requestId: MOCK_REQUEST_ID }) });
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toMatchObject({
      error: "Unauthorized",
      message: "You must be signed in to check inpainting status.",
    });
  });

  it("returns 429 when rate limited", async () => {
    vi.mocked(slidingWindowRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 60,
      resetsAt: new Date(Date.now() + 30_000),
    });

    const response = await GET(buildRequest(), { params: Promise.resolve({ requestId: MOCK_REQUEST_ID }) });
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.error).toBe("Too many requests");
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("returns 404 when request not found", async () => {
    vi.mocked(prisma.inpaintRequest.findUnique).mockResolvedValue(null);

    const response = await GET(buildRequest(), { params: Promise.resolve({ requestId: MOCK_REQUEST_ID }) });
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe("Request not found");
  });

  it("returns 404 when request belongs to different user", async () => {
    vi.mocked(prisma.inpaintRequest.findUnique).mockResolvedValue({
      id: MOCK_REQUEST_ID,
      status: "PROCESSING",
      resultUrl: null,
      room: { project: { userId: "different-user" } },
    });

    const response = await GET(buildRequest(), { params: Promise.resolve({ requestId: MOCK_REQUEST_ID }) });
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe("Request not found");
  });

  it("returns completed with stored resultUrl when already persisted", async () => {
    vi.mocked(prisma.inpaintRequest.findUnique).mockResolvedValue({
      id: MOCK_REQUEST_ID,
      status: "COMPLETED",
      resultUrl: "https://storage.example.com/after-creq123.png",
      room: { project: { userId: MOCK_USER_ID } },
    });
    vi.mocked(decideInpaintPersistence).mockReturnValue({
      kind: "return-stored",
      url: "https://storage.example.com/after-creq123.png",
    });

    const response = await GET(buildRequest(), { params: Promise.resolve({ requestId: MOCK_REQUEST_ID }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      status: "completed",
      imageUrl: "https://storage.example.com/after-creq123.png",
      persisted: true,
    });
  });

  it("returns in-progress status when processing (triggers fal poll)", async () => {
    vi.mocked(prisma.inpaintRequest.findUnique).mockResolvedValue({
      id: MOCK_REQUEST_ID,
      status: "PROCESSING",
      resultUrl: null,
      room: { project: { userId: MOCK_USER_ID } },
    });
    vi.mocked(decideInpaintPersistence).mockReturnValue({ kind: "persist" });
    vi.mocked(fal.queue.status).mockResolvedValue({
      status: "IN_PROGRESS",
      images: undefined,
    });

    const response = await GET(buildRequest(), { params: Promise.resolve({ requestId: MOCK_REQUEST_ID }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ status: "IN_PROGRESS" });
  });

  it("returns retryable status when persistence fails after fal completion", async () => {
    // Mock fetch to simulate successful image download
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(["fake-image-data"], { type: "image/png" })),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
    });
    globalThis.fetch = mockFetch;

    vi.mocked(prisma.inpaintRequest.findUnique).mockResolvedValue({
      id: MOCK_REQUEST_ID,
      status: "PROCESSING",
      resultUrl: null,
      room: { project: { userId: MOCK_USER_ID } },
    });
    vi.mocked(decideInpaintPersistence).mockReturnValue({ kind: "persist" });
    vi.mocked(fal.queue.status).mockResolvedValue({
      status: "COMPLETED",
      images: [{ url: "https://fal.result/image.png" }],
    });
    vi.mocked(fal.queue.result).mockResolvedValue({
      images: [{ url: "https://fal.result/final-image.png" }],
    });

    const response = await GET(buildRequest(), { params: Promise.resolve({ requestId: MOCK_REQUEST_ID }) });
    const json = await response.json();

    // When persistence fails (mocked supabase returns undefined), route returns retryable
    expect(response.status).toBe(200);
    expect(json.status).toBe("retryable");
    expect(json.imageUrl).toBe("https://fal.result/final-image.png");
    expect(json.persisted).toBe(false);

    // Clean up
    delete (globalThis as Record<string, unknown>).fetch;
  });

  it("returns 500 when fal returns ERROR status", async () => {
    vi.mocked(prisma.inpaintRequest.findUnique).mockResolvedValue({
      id: MOCK_REQUEST_ID,
      status: "PROCESSING",
      resultUrl: null,
      room: { project: { userId: MOCK_USER_ID } },
    });
    vi.mocked(decideInpaintPersistence).mockReturnValue({ kind: "persist" });
    vi.mocked(fal.queue.status).mockResolvedValue({
      status: "ERROR",
      error: "Processing failed",
    });
    vi.mocked(classifyIntegrationError).mockReturnValue({
      status: 500,
      error: "Inpainting failed",
      message: "The image editing process encountered an error. Please try again.",
      retryable: false,
    });

    const response = await GET(buildRequest(), { params: Promise.resolve({ requestId: MOCK_REQUEST_ID }) });
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json).toMatchObject({
      error: "Inpainting failed",
      retryable: false,
    });
  });

  it("handles unexpected errors gracefully", async () => {
    vi.mocked(prisma.inpaintRequest.findUnique).mockRejectedValue(new Error("Database error"));

    vi.mocked(classifyIntegrationError).mockReturnValue({
      status: 500,
      error: "Status check failed",
      message: "Unable to check image processing status. Please try again.",
      retryable: true,
    });

    const response = await GET(buildRequest(), { params: Promise.resolve({ requestId: MOCK_REQUEST_ID }) });
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("Status check failed");
  });
});
