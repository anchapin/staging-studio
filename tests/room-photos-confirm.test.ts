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

const listMock = vi.fn();
const removeMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(async () => ({
    storage: {
      from: vi.fn(() => ({
        list: listMock,
        remove: removeMock,
        getPublicUrl: vi.fn(() => ({
          data: { publicUrl: "https://ref.supabase.co/storage/v1/object/public/room-photos/rooms/room1/before-image.jpg" },
        })),
      })),
    },
  })),
}));

import { confirmRoomPhotoUpload } from "@/app/actions/room-photos";
import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { MAX_ROOM_PHOTO_BYTES } from "@/lib/storage-cleanup";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";
const MOCK_PROJECT_ID = "cproj12345678901234567890";
const SLOT_PATH = `rooms/${MOCK_ROOM_ID}/before-image.jpg`;

const mockUser = { id: MOCK_USER_ID, email: "test@example.com" };

describe("confirmRoomPhotoUpload size gate (issue #1145)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    vi.mocked(prisma.room.findFirst).mockResolvedValue({ id: MOCK_ROOM_ID } as never);
    vi.mocked(prisma.room.update).mockResolvedValue({ id: MOCK_ROOM_ID } as never);
    removeMock.mockResolvedValue({ error: null });
  });

  it("accepts an upload at or under the size cap and links it", async () => {
    listMock.mockResolvedValue({
      data: [{ name: "before-image.jpg", metadata: { size: MAX_ROOM_PHOTO_BYTES } }],
      error: null,
    });

    const result = await confirmRoomPhotoUpload(MOCK_ROOM_ID, MOCK_PROJECT_ID, SLOT_PATH, 0);

    expect(result.success).toBe(true);
    expect(prisma.room.update).toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("rejects and deletes an oversized upload before linking it", async () => {
    listMock.mockResolvedValue({
      data: [{ name: "before-image.jpg", metadata: { size: MAX_ROOM_PHOTO_BYTES + 1 } }],
      error: null,
    });

    const result = await confirmRoomPhotoUpload(MOCK_ROOM_ID, MOCK_PROJECT_ID, SLOT_PATH, 0);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("too large");
    expect(removeMock).toHaveBeenCalledWith([SLOT_PATH]);
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it("passes through when the object size is unreadable (missing object)", async () => {
    listMock.mockResolvedValue({ data: [], error: null });

    const result = await confirmRoomPhotoUpload(MOCK_ROOM_ID, MOCK_PROJECT_ID, SLOT_PATH, 0);

    expect(result.success).toBe(true);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
