import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
    room: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
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
    // Issue #1147: $transaction runs its callback against a tx client whose
    // room.update is the same mock prisma.room.update.
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = { room: { update: prisma.room.update } } as never;
      return (fn as (t: never) => Promise<unknown>)(tx);
    });
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

    it("updates sortOrder inside a transaction and returns success (issue #1147)", async () => {
      vi.mocked(requireProjectOwnershipSafe).mockResolvedValue({ project: { id: MOCK_PROJECT_ID } as never });
      vi.mocked(prisma.room.update).mockResolvedValue({ id: "room1" } as never);

      const result = await reorderRooms(MOCK_PROJECT_ID, ["room1", "room2"]);

      expect(result.success).toBe(true);
      // The writes run against the transaction client, not the root prisma.
      expect(prisma.room.update).toHaveBeenCalledTimes(2);
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "room1", projectId: MOCK_PROJECT_ID },
        data: { sortOrder: 0 },
      });
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "room2", projectId: MOCK_PROJECT_ID },
        data: { sortOrder: 1 },
      });
    });

    it("dedupes roomIds so a duplicate id gets one index (issue #1147)", async () => {
      vi.mocked(requireProjectOwnershipSafe).mockResolvedValue({ project: { id: MOCK_PROJECT_ID } as never });
      vi.mocked(prisma.room.update).mockResolvedValue({ id: "room1" } as never);

      const result = await reorderRooms(MOCK_PROJECT_ID, ["room1", "room2", "room1"]);

      expect(result.success).toBe(true);
      expect(prisma.room.update).toHaveBeenCalledTimes(2);
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "room1", projectId: MOCK_PROJECT_ID },
        data: { sortOrder: 0 },
      });
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: "room2", projectId: MOCK_PROJECT_ID },
        data: { sortOrder: 1 },
      });
    });

    it("returns failure and aborts when the transaction rejects (issue #1147)", async () => {
      vi.mocked(requireProjectOwnershipSafe).mockResolvedValue({ project: { id: MOCK_PROJECT_ID } as never });
      // P2025-style: a room deleted mid-reorder makes update() throw, which
      // aborts the transaction so no index change lands.
      vi.mocked(prisma.room.update).mockRejectedValue(new Error("Record to update not found."));

      const result = await reorderRooms(MOCK_PROJECT_ID, ["room1", "room2"]);

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toBe("Record to update not found.");
    });
  });
});
