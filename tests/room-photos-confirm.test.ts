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

vi.mock("@/lib/room-type-detection", () => ({
  detectRoomType: vi.fn(),
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
import { detectRoomType } from "@/lib/room-type-detection";

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";
const MOCK_PROJECT_ID = "cproj12345678901234567890";
const SLOT_PATH = `rooms/${MOCK_ROOM_ID}/before-image.jpg`;
const PUBLIC_URL = "https://ref.supabase.co/storage/v1/object/public/room-photos/rooms/room1/before-image.jpg";

const mockUser = { id: MOCK_USER_ID, email: "test@example.com" };

describe("confirmRoomPhotoUpload size gate (issue #1145)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    // Issue #1180: confirm now also reads `name` to decide auto-classify;
    // the existing size-gate tests don't exercise classification, so a
    // non-blank user-typed name keeps the auto-classify path inert.
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
      id: MOCK_ROOM_ID,
      name: "Living Room",
    } as never);
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

describe("confirmRoomPhotoUpload auto-classify (issue #1180)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAuthedPrismaUser).mockResolvedValue(mockUser as never);
    vi.mocked(prisma.room.update).mockResolvedValue({ id: MOCK_ROOM_ID } as never);
    removeMock.mockResolvedValue({ error: null });
    // Default size-gate pass-through (object exists, under cap).
    listMock.mockResolvedValue({
      data: [{ name: "before-image.jpg", metadata: { size: 1000 } }],
      error: null,
    });
  });

  it("prefills the room name when classification succeeds and the name was blank", async () => {
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
      id: MOCK_ROOM_ID,
      name: "",
    } as never);
    vi.mocked(detectRoomType).mockResolvedValue("Living Room" as never);

    const result = await confirmRoomPhotoUpload(MOCK_ROOM_ID, MOCK_PROJECT_ID, SLOT_PATH, 0);

    expect(result.success).toBe(true);
    // First update links the photo; second update writes the detected name.
    expect(prisma.room.update).toHaveBeenCalledTimes(2);
    expect(detectRoomType).toHaveBeenCalledWith(PUBLIC_URL);
    const nameUpdate = vi.mocked(prisma.room.update).mock.calls[1]?.[0] as {
      data: { name?: string; beforeImageUrl?: string };
    };
    expect(nameUpdate.data.name).toBe("Living Room");
  });

  it("prefills the room name when classification succeeds and the name was the 'Other' placeholder", async () => {
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
      id: MOCK_ROOM_ID,
      name: "Other",
    } as never);
    vi.mocked(detectRoomType).mockResolvedValue("Kitchen" as never);

    const result = await confirmRoomPhotoUpload(MOCK_ROOM_ID, MOCK_PROJECT_ID, SLOT_PATH, 0);

    expect(result.success).toBe(true);
    expect(detectRoomType).toHaveBeenCalledWith(PUBLIC_URL);
    expect(prisma.room.update).toHaveBeenCalledTimes(2);
    const nameUpdate = vi.mocked(prisma.room.update).mock.calls[1]?.[0] as {
      data: { name?: string };
    };
    expect(nameUpdate.data.name).toBe("Kitchen");
  });

  it("does NOT classify when the room already has a user-typed name", async () => {
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
      id: MOCK_ROOM_ID,
      name: "Sunroom",
    } as never);

    const result = await confirmRoomPhotoUpload(MOCK_ROOM_ID, MOCK_PROJECT_ID, SLOT_PATH, 0);

    expect(result.success).toBe(true);
    // Only the photo-link update fires — no second update, no classifier call.
    expect(prisma.room.update).toHaveBeenCalledTimes(1);
    expect(detectRoomType).not.toHaveBeenCalled();
  });

  it("leaves the room name blank when the classifier returns the 'Other' low-confidence sentinel", async () => {
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
      id: MOCK_ROOM_ID,
      name: "",
    } as never);
    vi.mocked(detectRoomType).mockResolvedValue("Other" as never);

    const result = await confirmRoomPhotoUpload(MOCK_ROOM_ID, MOCK_PROJECT_ID, SLOT_PATH, 0);

    expect(result.success).toBe(true);
    expect(detectRoomType).toHaveBeenCalled();
    // Low-confidence → only the photo-link update, name stays blank.
    expect(prisma.room.update).toHaveBeenCalledTimes(1);
    const photoLinkUpdate = vi.mocked(prisma.room.update).mock.calls[0]?.[0] as {
      data: { beforeImageUrl?: string; name?: string };
    };
    expect(photoLinkUpdate.data.name).toBeUndefined();
    expect(photoLinkUpdate.data.beforeImageUrl).toBe(PUBLIC_URL);
  });

  it("does NOT fail the upload when the classifier throws (timeout/provider error)", async () => {
    vi.mocked(prisma.room.findFirst).mockResolvedValue({
      id: MOCK_ROOM_ID,
      name: "",
    } as never);
    vi.mocked(detectRoomType).mockRejectedValue(new Error("classifier timeout"));

    const result = await confirmRoomPhotoUpload(MOCK_ROOM_ID, MOCK_PROJECT_ID, SLOT_PATH, 0);

    // Acceptance: "a classifier timeout must not fail an upload".
    expect(result.success).toBe(true);
    expect(detectRoomType).toHaveBeenCalled();
    // Photo link update completed; no follow-up name update.
    expect(prisma.room.update).toHaveBeenCalledTimes(1);
    const photoLinkUpdate = vi.mocked(prisma.room.update).mock.calls[0]?.[0] as {
      data: { beforeImageUrl?: string };
    };
    expect(photoLinkUpdate.data.beforeImageUrl).toBe(PUBLIC_URL);
  });
});
