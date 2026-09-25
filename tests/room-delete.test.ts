import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    room: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
  requireProjectOwnershipSafe: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser, requireProjectOwnershipSafe } from "@/lib/api-auth";
import { reorderRooms } from "@/app/actions/room-delete";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_PROJECT_ID = "cproj12345678901234567890";
const mockUser = { id: MOCK_USER_ID, email: "test@example.com", name: "Test User" };

describe("room-delete actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
  });

  describe("reorderRooms", () => {
    it("returns error when roomIds is empty", async () => {
      const result = await reorderRooms(MOCK_PROJECT_ID, []);

      expect(result.success).toBe(false);
      expect(result.error).toBe("roomIds must be a non-empty array");
    });

    it("returns error when not authenticated", async () => {
      vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

      const result = await reorderRooms(MOCK_PROJECT_ID, ["room1", "room2"]);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Not authenticated");
    });

    it("returns error when project not found", async () => {
      vi.mocked(requireProjectOwnershipSafe).mockResolvedValue(null);

      const result = await reorderRooms(MOCK_PROJECT_ID, ["room1", "room2"]);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Project not found");
    });

    it("updates sortOrder and returns success for valid input", async () => {
      vi.mocked(requireProjectOwnershipSafe).mockResolvedValue({ project: { id: MOCK_PROJECT_ID } as never });
      vi.mocked(prisma.room.updateMany).mockResolvedValue({ count: 1 } as never);

      const result = await reorderRooms(MOCK_PROJECT_ID, ["room1", "room2"]);

      expect(result.success).toBe(true);
      expect(prisma.room.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.room.updateMany).toHaveBeenCalledWith({
        where: { id: "room1", projectId: MOCK_PROJECT_ID },
        data: { sortOrder: 0 },
      });
      expect(prisma.room.updateMany).toHaveBeenCalledWith({
        where: { id: "room2", projectId: MOCK_PROJECT_ID },
        data: { sortOrder: 1 },
      });
    });
  });
});
