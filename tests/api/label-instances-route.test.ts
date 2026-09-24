/**
 * Label Instances Route - Schema Validation & 404 Tests
 *
 * Tests validation failures and not-found cases.
 * Auth, quota, AI success/error are covered by label-instances-quota.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "@/app/api/label-instances/route";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { generateWithCircuitBreaker } from "@/lib/ai";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";

const mockUser = {
  id: MOCK_USER_ID,
  email: "test@example.com",
  firmName: "Test Firm",
  ownerName: "Test Owner",
  logoUrl: null,
  psychologyPageContent: null,
  signoffContent: null,
  darkMode: false,
  createdAt: new Date(),
};

const mockRoom = {
  id: MOCK_ROOM_ID,
  name: "Living Room",
  projectId: "cproj123456789012345678",
  beforeImageUrl: null,
  beforeImageUrl2: null,
  afterImageUrl: "https://assets.example.com/room.jpg",
  afterImageUrl2: null,
  selectedVariantIndex: 0,
  rawDirectives: null,
  observedChallenge: null,
  recommendation: null,
  buyerPsychology: null,
  checklistItems: null,
  sortOrder: 0,
  createdAt: new Date(),
};

function buildRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: { findFirst: vi.fn() },
    visionLabel: { findMany: vi.fn(), createMany: vi.fn() },
    dailyApiUsage: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/lib/api-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-quota")>();
  return {
    ...actual,
    getDailyUsage: vi.fn(() => Promise.resolve(0)),
    resolveDailyLimit: vi.fn(() => 50),
  };
});

vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  generateWithCircuitBreaker: vi.fn(),
  assertOpenAIConfigured: vi.fn(),
}));

vi.mock("@/lib/error-classify", () => ({
  classifyIntegrationError: vi.fn(),
}));

vi.mock("@/lib/vision-labels", () => ({
  getCachedVisionLabels: vi.fn(() => Promise.resolve([])),
  upsertVisionLabels: vi.fn(() => Promise.resolve()),
}));

describe("POST /api/label-instances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue(mockRoom as typeof mockRoom);
    vi.mocked(prisma.visionLabel.findMany).mockResolvedValue([]);
    vi.mocked(prisma.visionLabel.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.dailyApiUsage.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.dailyApiUsage.update).mockResolvedValue({} as never);
    vi.mocked(prisma.dailyApiUsage.upsert).mockResolvedValue({} as never);
    vi.mocked(generateWithCircuitBreaker).mockImplementation(() =>
      Promise.resolve({
        object: [{ instanceIndex: 0, label: "Modern Grey Sofa", confidence: 0.97 }],
      })
    );
  });

  describe("Auth guard", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

      const response = await POST(buildRequest({ roomId: MOCK_ROOM_ID }));
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("Schema validation (labelInstancesPostSchema / visionLabelRequestSchema)", () => {
    it("returns 400 when roomId is missing", async () => {
      const response = await POST(
        buildRequest({
          concept: "sofa",
          crops: [{ instanceIndex: 0, cropDataUrl: "https://crop.supabase.co/img.jpg" }],
          imageUrl: "https://room.supabase.co/room.jpg",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid request");
    });

    it("returns 400 when concept is empty string", async () => {
      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "",
          crops: [{ instanceIndex: 0, cropDataUrl: "https://crop.supabase.co/img.jpg" }],
          imageUrl: "https://room.supabase.co/room.jpg",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid request");
    });

    it("returns 400 when crops is empty array", async () => {
      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "sofa",
          crops: [],
          imageUrl: "https://room.supabase.co/room.jpg",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid request");
    });

    it("returns 400 when concept exceeds 200 characters", async () => {
      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "a".repeat(201),
          crops: [{ instanceIndex: 0, cropDataUrl: "https://crop.supabase.co/img.jpg" }],
          imageUrl: "https://room.supabase.co/room.jpg",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid request");
    });

    it("returns 400 when crops.instanceIndex is negative", async () => {
      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "sofa",
          crops: [{ instanceIndex: -1, cropDataUrl: "https://crop.supabase.co/img.jpg" }],
          imageUrl: "https://room.supabase.co/room.jpg",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid request");
    });

    it("returns 400 when imageUrl is not a valid https URL", async () => {
      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "sofa",
          crops: [{ instanceIndex: 0, cropDataUrl: "https://crop.supabase.co/img.jpg" }],
          imageUrl: "not-a-url",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid request");
    });

    it("returns 400 when imageUrl host is not allowlisted (not *.supabase.co or *.fal.ai)", async () => {
      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "sofa",
          crops: [{ instanceIndex: 0, cropDataUrl: "https://crop.supabase.co/img.jpg" }],
          imageUrl: "https://evil.com/room.jpg",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid request");
    });

    it("returns 400 when crop dataUrl host is not allowlisted", async () => {
      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "sofa",
          crops: [{ instanceIndex: 0, cropDataUrl: "https://evil.com/crop.jpg" }],
          imageUrl: "https://room.supabase.co/room.jpg",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid request");
    });

    it("returns 400 when strict schema rejects unknown fields", async () => {
      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "sofa",
          crops: [{ instanceIndex: 0, cropDataUrl: "https://crop.supabase.co/img.jpg" }],
          imageUrl: "https://room.supabase.co/room.jpg",
          unknownField: "should be rejected",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid request");
    });

    it("accepts fal.ai URLs in crops and imageUrl fields", async () => {
      vi.mocked(prisma.room.findFirst).mockResolvedValue(mockRoom as typeof mockRoom);
      vi.mocked(generateWithCircuitBreaker).mockImplementation(() =>
        Promise.resolve({ object: { labels: [] } })
      );

      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "sofa",
          crops: [{ instanceIndex: 0, cropDataUrl: "https://crop.fal.ai/img.jpg" }],
          imageUrl: "https://room.fal.ai/room.jpg",
        })
      );

      expect(response.status).toBe(200);
    });
  });

  describe("Room lookup", () => {
    it("returns 404 when room does not exist", async () => {
      vi.mocked(prisma.room.findFirst).mockResolvedValue(null);

      const response = await POST(
        buildRequest({
          roomId: "nonexistent-room",
          concept: "sofa",
          crops: [{ instanceIndex: 0, cropDataUrl: "https://crop.supabase.co/img.jpg" }],
          imageUrl: "https://room.supabase.co/room.jpg",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe("Room not found");
      expect(body.message).toBe("The requested room could not be found.");
    });

    it("returns 404 when room belongs to a different user", async () => {
      vi.mocked(prisma.room.findFirst).mockResolvedValue(null);

      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "sofa",
          crops: [{ instanceIndex: 0, cropDataUrl: "https://crop.supabase.co/img.jpg" }],
          imageUrl: "https://room.supabase.co/room.jpg",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe("Room not found");
    });
  });

  describe("AI success", () => {
    it("returns 200 with labels array when AI call succeeds", async () => {
      // Mock the wrapped function, not generateWithCircuitBreaker itself
      vi.mocked(generateWithCircuitBreaker).mockImplementation(async () => ({
        object: {
          labels: [
            { instanceIndex: 0, label: "Modern Grey Sofa", confidence: 0.97 },
            { instanceIndex: 1, label: "Wooden Coffee Table", confidence: 0.95 },
          ],
        },
      }));

      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "sofa",
          crops: [
            { instanceIndex: 0, cropDataUrl: "https://crop.supabase.co/img0.jpg" },
            { instanceIndex: 1, cropDataUrl: "https://crop.supabase.co/img1.jpg" },
          ],
          imageUrl: "https://room.supabase.co/room.jpg",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.labels).toHaveLength(2);
      expect(body.labels[0].label).toBe("Modern Grey Sofa");
      expect(body.labels[1].label).toBe("Wooden Coffee Table");
    });
  });

  describe("Error handling", () => {
    it("returns 500 when generateWithCircuitBreaker throws", async () => {
      vi.mocked(generateWithCircuitBreaker).mockRejectedValue(new Error("OpenAI API error"));

      const response = await POST(
        buildRequest({
          roomId: MOCK_ROOM_ID,
          concept: "sofa",
          crops: [{ instanceIndex: 0, cropDataUrl: "https://crop.supabase.co/img.jpg" }],
          imageUrl: "https://room.supabase.co/room.jpg",
        })
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Internal server error");
      expect(body.message).toBe("OpenAI API error");
    });
  });
});
