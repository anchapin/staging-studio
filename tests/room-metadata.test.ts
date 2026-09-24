import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted so the mock is fresh for each test run and doesn't retain
// state from the full suite run
const mockPrisma = vi.hoisted(() => ({
  room: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));

const mockGetAuthedPrismaUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: mockGetAuthedPrismaUser,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { saveRoomMetadata } from "@/app/actions/room-metadata";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";
const mockUser = { id: MOCK_USER_ID, email: "test@example.com", name: "Test User" };

describe("room-metadata actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Restore hoisted mock implementations after reset
    vi.mocked(mockPrisma.room.findFirst).mockReset().mockResolvedValue(null);
    vi.mocked(mockPrisma.room.update).mockReset().mockResolvedValue(null);
    vi.mocked(mockGetAuthedPrismaUser).mockReset().mockResolvedValue(mockUser as never);
  });

  describe("saveRoomMetadata", () => {
    it("returns error when not authenticated", async () => {
      vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

      const result = await saveRoomMetadata(MOCK_ROOM_ID, { name: "Living Room" });

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toBe("Not authenticated");
    });

    it("returns error when room not found", async () => {
      vi.mocked(prisma.room.findFirst).mockResolvedValue(null);

      const result = await saveRoomMetadata(MOCK_ROOM_ID, { name: "Living Room" });

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toBe("Room not found");
    });

    it("updates metadata and returns success for valid input", async () => {
      vi.mocked(prisma.room.findFirst).mockResolvedValue({
        id: MOCK_ROOM_ID,
        projectId: "pid",
        project: { id: "pid", userId: MOCK_USER_ID },
      } as never);
      vi.mocked(prisma.room.update).mockResolvedValue({ id: MOCK_ROOM_ID } as never);

      const result = await saveRoomMetadata(MOCK_ROOM_ID, {
        name: "Living Room",
        rawDirectives: "Stage this room for first-time buyers",
      });

      expect(result.success).toBe(true);
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: MOCK_ROOM_ID, project: { userId: MOCK_USER_ID } },
        data: {
          name: "Living Room",
          rawDirectives: "Stage this room for first-time buyers",
        },
      });
    });
  });
});
