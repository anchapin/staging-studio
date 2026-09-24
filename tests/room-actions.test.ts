import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    room: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
  // Default: findFirst returns a valid room so saveRoomMetadata proceeds to update
  vi.mocked(prisma.room.findFirst).mockResolvedValue({
    id: "room-1",
    projectId: "proj-1",
    name: "Living Room",
    beforeImageUrl: null,
    beforeImageUrl2: null,
    afterImageUrl: null,
    afterImageUrl2: null,
    selectedVariantIndex: 0,
    sortOrder: 0,
    rawDirectives: null,
    observedChallenge: null,
    recommendation: null,
    buyerPsychology: null,
    checklistItems: null,
    createdAt: new Date(),
  });
});

import { saveRoomMetadata } from "@/app/actions/room";
import { reorderRooms } from "@/app/actions/room";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

describe("saveRoomMetadata", () => {
  const validMeta = {
    name: "Living Room",
    rawDirectives: "Make it modern",
  };

  it("returns error when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await saveRoomMetadata("room-1", validMeta);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("updates room metadata on success", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.update).mockResolvedValue({
      id: "room-1",
      projectId: "proj-1",
      name: validMeta.name,
      beforeImageUrl: null,
      beforeImageUrl2: null,
      afterImageUrl: null,
      afterImageUrl2: null,
      selectedVariantIndex: 0,
      sortOrder: 0,
      rawDirectives: validMeta.rawDirectives,
      observedChallenge: null,
      recommendation: null,
      buyerPsychology: null,
      checklistItems: null,
      createdAt: new Date(),
    });

    const result = await saveRoomMetadata("room-1", validMeta);

    expect(result).toEqual({ success: true });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: "room-1", project: { userId: mockUser.id } },
      data: expect.objectContaining({
        name: validMeta.name,
        rawDirectives: validMeta.rawDirectives,
      }),
    });
  });

  it("propagates errors from database", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.room.update).mockRejectedValue(new Error("Connection error"));

    const result = await saveRoomMetadata("room-1", validMeta);

    expect(result).toEqual({ success: false, error: "Connection error" });
  });
});

describe("reorderRooms", () => {
  it("returns error when not authenticated", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

    const result = await reorderRooms("proj-1", ["room-2", "room-1"]);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns error when project not found", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);

    const result = await reorderRooms("proj-1", ["room-2", "room-1"]);

    expect(result).toEqual({ success: false, error: "Project not found" });
  });

  it("reorders rooms on success", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: "proj-1" } as any);
    vi.mocked(prisma.room.updateMany).mockResolvedValue({ count: 1 });

    const result = await reorderRooms("proj-1", ["room-2", "room-1"]);

    expect(result).toEqual({ success: true });
    expect(prisma.room.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.room.updateMany).toHaveBeenCalledWith({
      where: { id: "room-2", projectId: "proj-1" },
      data: { sortOrder: 0 },
    });
    expect(prisma.room.updateMany).toHaveBeenCalledWith({
      where: { id: "room-1", projectId: "proj-1" },
      data: { sortOrder: 1 },
    });
  });

  it("propagates database errors", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: "proj-1" } as any);
    vi.mocked(prisma.room.updateMany).mockRejectedValue(new Error("DB error"));

    const result = await reorderRooms("proj-1", ["room-2", "room-1"]);

    expect(result).toEqual({ success: false, error: "DB error" });
  });

  it("returns error for empty roomIds array", async () => {
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser);

    const result = await reorderRooms("proj-1", []);

    expect(result).toEqual({ success: false, error: "roomIds must be a non-empty array" });
  });
});
