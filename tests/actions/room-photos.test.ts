import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  getSignedUploadUrl,
  confirmRoomPhotoUpload,
} from "@/app/actions/room-photos";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { withRetry } from "@/lib/retry";

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

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(),
}));

vi.mock("@/lib/retry", () => ({
  withRetry: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const authedUser = getAuthedPrismaUser as unknown as Mock;
const prismaRoomFindFirst = prisma.room.findFirst as unknown as Mock;
const prismaRoomUpdate = prisma.room.update as unknown as Mock;
const createSupabaseClient = createSupabaseRequestClient as unknown as Mock;
const retry = withRetry as unknown as Mock;

const USER_ID = "user-1";
const ROOM_ID = "room-1";
const PROJECT_ID = "project-1";

function setupSupabaseSignedUrlMock(signedUrl: string, storagePath: string) {
  createSupabaseClient.mockResolvedValue({
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUploadUrl: vi
          .fn()
          .mockResolvedValue({ data: { signedUrl, storagePath }, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({
          data: {
            publicUrl: `https://example.supabase.co/storage/v1/object/public/room-photos/${storagePath}`,
          },
        }),
      }),
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  authedUser.mockResolvedValue({ id: USER_ID });
  retry.mockImplementation(async (fn) => fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getSignedUploadUrl", () => {
  const fileName = "living-room.jpg";
  const storagePath = `rooms/${ROOM_ID}/before-image.jpg`;

  it("returns signed URL on success for variant slot 0", async () => {
    prismaRoomFindFirst.mockResolvedValue({ id: ROOM_ID });
    setupSupabaseSignedUrlMock("https://signed.url/upload", storagePath);

    const result = await getSignedUploadUrl(ROOM_ID, fileName, 0);

    expect(result).toEqual({
      success: true,
      signedUrl: "https://signed.url/upload",
      storagePath,
    });
    expect(prismaRoomFindFirst).toHaveBeenCalledWith({
      where: { id: ROOM_ID, project: { userId: USER_ID } },
      select: { id: true },
    });
  });

  it("returns signed URL on success for variant slot 1", async () => {
    prismaRoomFindFirst.mockResolvedValue({ id: ROOM_ID });
    const slot1StoragePath = `rooms/${ROOM_ID}/before-image-2.png`;
    setupSupabaseSignedUrlMock("https://signed.url/upload", slot1StoragePath);

    const result = await getSignedUploadUrl(ROOM_ID, "bedroom.png", 1);

    expect(result).toEqual({
      success: true,
      signedUrl: "https://signed.url/upload",
      storagePath: slot1StoragePath,
    });
  });

  it("returns failure for invalid variant slot", async () => {
    const result = await getSignedUploadUrl(ROOM_ID, fileName, 2);

    expect(result).toEqual({
      success: false,
      error: "Invalid variant slot: must be 0 or 1",
    });
    expect(prismaRoomFindFirst).not.toHaveBeenCalled();
  });

  it("returns failure for unsupported file extension", async () => {
    const result = await getSignedUploadUrl(ROOM_ID, "video.mp4", 0);

    expect(result).toEqual({
      success: false,
      error:
        "Unsupported image extension: .mp4. Allowed: jpg, jpeg, png, webp",
    });
    expect(prismaRoomFindFirst).not.toHaveBeenCalled();
  });

  it("returns failure when not authenticated", async () => {
    authedUser.mockResolvedValue(null);

    const result = await getSignedUploadUrl(ROOM_ID, fileName, 0);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns failure when room not found or not owned", async () => {
    prismaRoomFindFirst.mockResolvedValue(null);

    const result = await getSignedUploadUrl(ROOM_ID, fileName, 0);

    expect(result).toEqual({
      success: false,
      error: "Room not found or not owned by user",
    });
  });

  it("returns failure when Supabase storage error occurs", async () => {
    prismaRoomFindFirst.mockResolvedValue({ id: ROOM_ID });
    retry.mockImplementation(async () => ({
      data: null,
      error: { message: "Storage bucket not found" },
    }));

    const result = await getSignedUploadUrl(ROOM_ID, fileName, 0);

    expect(result).toEqual({
      success: false,
      error: "Failed to get signed URL: Storage bucket not found",
    });
  });

  it("handles uppercase file extension as lowercase", async () => {
    prismaRoomFindFirst.mockResolvedValue({ id: ROOM_ID });
    setupSupabaseSignedUrlMock("https://signed.url/upload", storagePath);

    const result = await getSignedUploadUrl(ROOM_ID, "kitchen.JPEG", 0);

    expect(result.success).toBe(true);
  });
});

describe("confirmRoomPhotoUpload", () => {
  const storagePath = `rooms/${ROOM_ID}/before-image.jpg`;
  const publicUrl = `https://example.supabase.co/storage/v1/object/public/room-photos/${storagePath}`;

  it("returns public URL on success for variant slot 0", async () => {
    authedUser.mockResolvedValue({ id: USER_ID });
    createSupabaseClient.mockResolvedValue({
      storage: {
        from: vi.fn().mockReturnValue({
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl } }),
        }),
      },
    });
    prismaRoomUpdate.mockResolvedValue({ id: ROOM_ID });

    const result = await confirmRoomPhotoUpload(
      ROOM_ID,
      PROJECT_ID,
      storagePath,
      0
    );

    expect(result).toEqual({ success: true, publicUrl });
    expect(prismaRoomUpdate).toHaveBeenCalledWith({
      where: { id: ROOM_ID, project: { userId: USER_ID } },
      data: { beforeImageUrl: publicUrl },
    });
  });

  it("returns public URL on success for variant slot 1", async () => {
    authedUser.mockResolvedValue({ id: USER_ID });
    const slot1StoragePath = `rooms/${ROOM_ID}/before-image-2.png`;
    const slot1PublicUrl = `https://example.supabase.co/storage/v1/object/public/room-photos/${slot1StoragePath}`;
    createSupabaseClient.mockResolvedValue({
      storage: {
        from: vi.fn().mockReturnValue({
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: slot1PublicUrl } }),
        }),
      },
    });
    prismaRoomUpdate.mockResolvedValue({ id: ROOM_ID });

    const result = await confirmRoomPhotoUpload(
      ROOM_ID,
      PROJECT_ID,
      slot1StoragePath,
      1
    );

    expect(result).toEqual({ success: true, publicUrl: slot1PublicUrl });
    expect(prismaRoomUpdate).toHaveBeenCalledWith({
      where: { id: ROOM_ID, project: { userId: USER_ID } },
      data: { beforeImageUrl2: slot1PublicUrl },
    });
  });

  it("returns failure for invalid variant slot", async () => {
    const result = await confirmRoomPhotoUpload(
      ROOM_ID,
      PROJECT_ID,
      storagePath,
      2
    );

    expect(result).toEqual({
      success: false,
      error: "Invalid variant slot: must be 0 or 1",
    });
    expect(prismaRoomUpdate).not.toHaveBeenCalled();
  });

  it("returns failure when storage path does not match expected pattern", async () => {
    const result = await confirmRoomPhotoUpload(
      ROOM_ID,
      PROJECT_ID,
      "rooms/wrong-room-id/before-image.jpg",
      0
    );

    expect(result).toEqual({
      success: false,
      error:
        "Storage path does not match the expected path for this room and variant slot",
    });
    expect(prismaRoomUpdate).not.toHaveBeenCalled();
  });

  it("returns failure when not authenticated", async () => {
    authedUser.mockResolvedValue(null);

    const result = await confirmRoomPhotoUpload(
      ROOM_ID,
      PROJECT_ID,
      storagePath,
      0
    );

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns failure when Prisma update throws", async () => {
    authedUser.mockResolvedValue({ id: USER_ID });
    createSupabaseClient.mockResolvedValue({
      storage: {
        from: vi.fn().mockReturnValue({
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl } }),
        }),
      },
    });
    prismaRoomUpdate.mockRejectedValue(new Error("Database constraint violation"));

    const result = await confirmRoomPhotoUpload(
      ROOM_ID,
      PROJECT_ID,
      storagePath,
      0
    );

    expect(result).toEqual({
      success: false,
      error: "Database constraint violation",
    });
  });

  it("returns failure for tampered storage path with wrong room ID", async () => {
    authedUser.mockResolvedValue({ id: USER_ID });
    createSupabaseClient.mockResolvedValue({
      storage: {
        from: vi.fn().mockReturnValue({
          getPublicUrl: vi.fn().mockReturnValue({
            data: { publicUrl: "https://example.supabase.co/storage/v1/object/public/room-photos/rooms/wrong-room/before-image.webp" },
          }),
        }),
      },
    });

    const result = await confirmRoomPhotoUpload(
      ROOM_ID,
      PROJECT_ID,
      "rooms/wrong-room/before-image.webp",
      0
    );

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("does not match"),
    });
  });
});
