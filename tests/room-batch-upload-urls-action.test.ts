import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    room: {
      update: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firmName: "Test Firm",
  ownerName: "Test Owner",
  logoUrl: null,
  psychologyPageContent: null,
  signoffContent: null,
  darkMode: false,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

import { getBatchRoomUploadUrls } from "@/app/actions/room-batch";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

describe("getBatchRoomUploadUrls", () => {
  const projectId = "c123456789012345678901234";
  const files = [
    { name: "room1.jpg" },
    { name: "room2.jpg" },
  ];

  it("returns error when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await getBatchRoomUploadUrls(projectId, files);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns error when project not found", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

    const result = await getBatchRoomUploadUrls(projectId, files);

    expect(result).toEqual({ success: false, error: "Project not found" });
  });
});
