import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  saveRoomCopy,
  saveRoomCopyEdits,
} from "@/app/actions/room-copy";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";
const mockUser = { id: MOCK_USER_ID, email: "test@example.com", name: "Test User" };

const validGeneratedCopy = {
  observedChallenge: "Clutter in living areas",
  buyerPsychology: "Buyers want open spaces",
  recommendation: "Declutter and stage",
  checklist: [
    { item: "Remove personal items", category: "DIY/Declutter", priority: "High" },
  ],
} as Parameters<typeof saveRoomCopy>[1];

describe("room-copy actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
  });

  describe("saveRoomCopy", () => {
    it("returns error when not authenticated", async () => {
      vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

      const result = await saveRoomCopy(MOCK_ROOM_ID, validGeneratedCopy);

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toBe("Not authenticated");
    });

    it("returns error when room not found", async () => {
      vi.mocked(prisma.room.findFirst).mockResolvedValue(null);

      const result = await saveRoomCopy(MOCK_ROOM_ID, validGeneratedCopy);

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toBe("Room not found");
    });

    it("saves copy and returns success for valid input", async () => {
      vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: MOCK_ROOM_ID } as never);
      vi.mocked(prisma.room.update).mockResolvedValue({ id: MOCK_ROOM_ID } as never);

      const result = await saveRoomCopy(MOCK_ROOM_ID, validGeneratedCopy);

      expect(result.success).toBe(true);
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: MOCK_ROOM_ID },
        data: {
          observedChallenge: "Clutter in living areas",
          buyerPsychology: "Buyers want open spaces",
          recommendation: "Declutter and stage",
          checklistItems: validGeneratedCopy.checklist,
        },
      });
    });
  });

  describe("saveRoomCopyEdits", () => {
    it("returns error when not authenticated", async () => {
      vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

      const result = await saveRoomCopyEdits(MOCK_ROOM_ID, {
        observedChallenge: "Clutter",
        buyerPsychology: "Needs space",
        recommendation: "Declutter",
        checklistItems: [
          { item: "Remove personal items", category: "DIY/Declutter", priority: "High" },
        ],
      } as never);

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toBe("Not authenticated");
    });

    it("saves copy edits and returns success for valid input", async () => {
      vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: MOCK_ROOM_ID } as never);
      vi.mocked(prisma.room.update).mockResolvedValue({ id: MOCK_ROOM_ID } as never);

      const result = await saveRoomCopyEdits(MOCK_ROOM_ID, {
        observedChallenge: "Clutter",
        buyerPsychology: "Needs space",
        recommendation: "Declutter",
        checklistItems: [
          { item: "Remove personal items", category: "DIY/Declutter", priority: "High" },
        ],
      } as never);

      expect(result.success).toBe(true);
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: MOCK_ROOM_ID },
        data: {
          observedChallenge: "Clutter",
          buyerPsychology: "Needs space",
          recommendation: "Declutter",
          checklistItems: [
            { item: "Remove personal items", category: "DIY/Declutter", priority: "High" },
          ],
        },
      });
    });
  });
});
