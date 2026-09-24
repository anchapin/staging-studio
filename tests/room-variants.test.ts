import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    inpaintRequest: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/variant-legibility", () => ({
  resolveSelectionAfterDelete: vi.fn().mockReturnValue(0),
}));

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  getVariantTouchUpCounts,
  deleteVariantAfterImage,
} from "@/app/actions/room-variants";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";
const mockUser = { id: MOCK_USER_ID, email: "test@example.com", name: "Test User" };

describe("room-variants actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
  });

  describe("getVariantTouchUpCounts", () => {
    it("returns error when not authenticated", async () => {
      vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

      const result = await getVariantTouchUpCounts(MOCK_ROOM_ID);

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toBe("Not authenticated");
    });

    it("returns touch-up counts for valid room", async () => {
      vi.mocked(prisma.inpaintRequest.findMany).mockResolvedValue([
        { id: "1", status: "succeeded", requestedAt: new Date() },
        { id: "2", status: "succeeded", requestedAt: new Date() },
      ] as never);

      const result = await getVariantTouchUpCounts(MOCK_ROOM_ID);

      expect(result.success).toBe(true);
      expect(result.counts).toEqual({ 0: 2, 1: 2 });
    });
  });

  describe("deleteVariantAfterImage", () => {
    it("returns error for invalid slot", async () => {
      const result = await deleteVariantAfterImage(MOCK_ROOM_ID, 2);

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toBe("Invalid variant slot: must be 0 or 1");
    });

    it("returns error when not authenticated", async () => {
      vi.mocked(getAuthedPrismaUser).mockResolvedValue(null);

      const result = await deleteVariantAfterImage(MOCK_ROOM_ID, 0);

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toBe("Not authenticated");
    });

    it("returns error when room not found", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue(null);

      const result = await deleteVariantAfterImage(MOCK_ROOM_ID, 0);

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toBe("Room not found");
    });

    it("deletes slot 0 and returns success", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: MOCK_ROOM_ID,
        afterImageUrl: "https://example.com/after0.jpg",
        afterImageUrl2: "https://example.com/after1.jpg",
        beforeImageUrl: "https://example.com/before0.jpg",
        beforeImageUrl2: "https://example.com/before1.jpg",
        selectedVariantIndex: 0,
      } as never);
      vi.mocked(prisma.room.update).mockResolvedValue({ id: MOCK_ROOM_ID } as never);

      const result = await deleteVariantAfterImage(MOCK_ROOM_ID, 0);

      expect(result.success).toBe(true);
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: MOCK_ROOM_ID },
        data: { afterImageUrl: null, selectedVariantIndex: 0 },
      });
    });

    it("deletes slot 1 and returns success", async () => {
      vi.mocked(prisma.room.findUnique).mockResolvedValue({
        id: MOCK_ROOM_ID,
        afterImageUrl: "https://example.com/after0.jpg",
        afterImageUrl2: "https://example.com/after1.jpg",
        beforeImageUrl: "https://example.com/before0.jpg",
        beforeImageUrl2: "https://example.com/before1.jpg",
        selectedVariantIndex: 1,
      } as never);
      vi.mocked(prisma.room.update).mockResolvedValue({ id: MOCK_ROOM_ID } as never);

      const result = await deleteVariantAfterImage(MOCK_ROOM_ID, 1);

      expect(result.success).toBe(true);
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: MOCK_ROOM_ID },
        data: { afterImageUrl2: null, selectedVariantIndex: 1 },
      });
    });
  });
});
