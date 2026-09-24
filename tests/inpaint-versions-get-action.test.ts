import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findFirst: vi.fn(),
    },
    inpaintVersion: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

const mockUser = { id: "user-1", email: "test@example.com", firmName: "Test Firm", firmLogoUrl: null, pageTemplate: null, darkMode: false };

beforeEach(() => {
  vi.clearAllMocks();
});

import { getInpaintVersions } from "@/app/actions/inpaint-versions";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

describe("getInpaintVersions", () => {
  it("returns error when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await getInpaintVersions("room-1", 0);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns error when room not found", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue(null);

    const result = await getInpaintVersions("room-1", 0);

    expect(result).toEqual({ success: false, error: "Room not found or not owned by user" });
  });

  it("returns versions for given room and variant slot", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: "room-1" });
    const mockVersions = [
      {
        id: "v-1",
        resultUrl: "https://storage.supabase.co/v1/result1.jpg",
        thumbnailUrl: "https://storage.supabase.co/v1/thumb1.jpg",
        seed: "12345",
        promptDirectives: "Make it brighter",
        createdAt: new Date("2024-01-01"),
      },
      {
        id: "v-2",
        resultUrl: "https://storage.supabase.co/v1/result2.jpg",
        thumbnailUrl: "https://storage.supabase.co/v1/thumb2.jpg",
        seed: "67890",
        promptDirectives: "Add plants",
        createdAt: new Date("2024-01-02"),
      },
    ];
    vi.mocked(prisma.inpaintVersion.findMany).mockResolvedValue(mockVersions);

    const result = await getInpaintVersions("room-1", 0);

    expect(result.success).toBe(true);
    expect(result.versions).toHaveLength(2);
  });

  it("returns empty array when no versions exist", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: "room-1" });
    vi.mocked(prisma.inpaintVersion.findMany).mockResolvedValue([]);

    const result = await getInpaintVersions("room-1", 0);

    expect(result.success).toBe(true);
    expect(result.versions).toEqual([]);
  });

  it("throws when database query fails", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: "room-1" });
    vi.mocked(prisma.inpaintVersion.findMany).mockRejectedValue(new Error("Connection lost"));

    await expect(getInpaintVersions("room-1", 0)).rejects.toThrow("Connection lost");
  });
});
