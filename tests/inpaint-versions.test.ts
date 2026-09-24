import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  saveInpaintVersion,
  getInpaintVersions,
  restoreInpaintVersion,
} from "@/app/actions/inpaint-versions";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { createSupabaseRequestClient } from "@/lib/supabase";
import { validateThumbnailDataUrl } from "@/lib/thumbnail-data-url";
import { versionThumbnailStoragePath, fifoEvictionTake } from "@/lib/inpaint-version-storage";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    room: { findFirst: vi.fn(), update: vi.fn() },
    inpaintVersion: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(),
}));

vi.mock("@/lib/thumbnail-data-url", () => ({
  validateThumbnailDataUrl: vi.fn(),
}));

vi.mock("@/lib/inpaint-version-storage", () => ({
  versionThumbnailStoragePath: vi.fn(),
  fifoEvictionTake: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const authedUser = getAuthedPrismaUser as unknown as Mock;
const prismaRoomFindFirst = prisma.room.findFirst as unknown as Mock;
const prismaRoomUpdate = prisma.room.update as unknown as Mock;
const prismaVersionFindUnique = prisma.inpaintVersion.findUnique as unknown as Mock;
const prismaVersionFindMany = prisma.inpaintVersion.findMany as unknown as Mock;
const prismaVersionCreate = prisma.inpaintVersion.create as unknown as Mock;
const prismaVersionCount = prisma.inpaintVersion.count as unknown as Mock;
const prismaVersionDeleteMany = prisma.inpaintVersion.deleteMany as unknown as Mock;
const prismaTransaction = prisma.$transaction as unknown as Mock;
const createSupabaseClient = createSupabaseRequestClient as unknown as Mock;
const validateThumbnail = validateThumbnailDataUrl as unknown as Mock;
const storagePath = versionThumbnailStoragePath as unknown as Mock;
const fifoTake = fifoEvictionTake as unknown as Mock;

const USER_ID = "user-1";
const ROOM_ID = "room-1";
const PROJECT_ID = "project-1";
const VERSION_ID = "version-1";
const THUMBNAIL_URL =
  "https://example.supabase.co/storage/v1/object/public/room-photos/rooms/room-1/variant0/thumb.jpg";

const BASE_ARGS = {
  roomId: ROOM_ID,
  variantSlot: 0 as const,
  resultUrl: "https://example.supabase.co/storage/v1/object/public/staging-images/result.jpg",
  thumbnailDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
  seed: "12345",
  promptDirectives: "Brighten the room",
};

function setupHappyPathTransaction() {
  prismaTransaction.mockImplementation(async (callback) => {
    prismaVersionCount.mockResolvedValue(0);
    prismaVersionFindMany.mockResolvedValue([]);
    prismaVersionDeleteMany.mockResolvedValue({ count: 0 });
    prismaVersionCreate.mockResolvedValue({ id: VERSION_ID });
    (prisma.$queryRaw as unknown as Mock).mockImplementation(() => Promise.resolve());
    return callback(prisma);
  });
}

function setupEvictingTransaction(evictedId: string) {
  prismaTransaction.mockImplementation(async (callback) => {
    prismaVersionCount.mockResolvedValue(20);
    prismaVersionFindMany.mockResolvedValue([{ id: evictedId, thumbnailUrl: THUMBNAIL_URL }]);
    prismaVersionDeleteMany.mockResolvedValue({ count: 1 });
    prismaVersionCreate.mockResolvedValue({ id: VERSION_ID });
    (prisma.$queryRaw as unknown as Mock).mockImplementation(() => Promise.resolve());
    return callback(prisma);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  authedUser.mockResolvedValue({ id: USER_ID });
  createSupabaseClient.mockResolvedValue({
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: "path" }, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: THUMBNAIL_URL } }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveInpaintVersion", () => {
  beforeEach(() => {
    prismaRoomFindFirst.mockResolvedValue({ id: ROOM_ID });
    validateThumbnail.mockReturnValue({ ok: true });
    storagePath.mockReturnValue("rooms/room-1/variant0/thumb.jpg");
    fifoTake.mockReturnValue(0);
    setupHappyPathTransaction();
  });

  it("creates a version and returns the versionId", async () => {
    const result = await saveInpaintVersion(BASE_ARGS);

    expect(result).toEqual({ success: true, versionId: VERSION_ID });
    expect(prismaVersionCreate).toHaveBeenCalledWith({
      data: {
        roomId: ROOM_ID,
        variantSlot: 0,
        resultUrl: BASE_ARGS.resultUrl,
        thumbnailUrl: THUMBNAIL_URL,
        seed: "12345",
        promptDirectives: "Brighten the room",
      },
    });
  });

  it("returns failure when not authenticated", async () => {
    authedUser.mockResolvedValue(null);

    const result = await saveInpaintVersion(BASE_ARGS);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(prismaVersionCreate).not.toHaveBeenCalled();
  });

  it("returns failure when room not found or not owned", async () => {
    prismaRoomFindFirst.mockResolvedValue(null);

    const result = await saveInpaintVersion(BASE_ARGS);

    expect(result).toEqual({ success: false, error: "Room not found or not owned by user" });
    expect(prismaVersionCreate).not.toHaveBeenCalled();
  });

  it("evicts oldest versions when cap is exceeded", async () => {
    const evictedId = "old-version-id";
    fifoTake.mockReturnValue(1);
    setupEvictingTransaction(evictedId);

    const result = await saveInpaintVersion(BASE_ARGS);

    expect(result).toEqual({ success: true, versionId: VERSION_ID });
  });
});

describe("getInpaintVersions", () => {
  const VERSIONS = [
    {
      id: "v3",
      resultUrl: "https://example.com/v3.jpg",
      thumbnailUrl: "https://example.com/v3-thumb.jpg",
      seed: "333",
      promptDirectives: "Version 3 directives",
      createdAt: new Date("2024-01-03"),
    },
    {
      id: "v2",
      resultUrl: "https://example.com/v2.jpg",
      thumbnailUrl: "https://example.com/v2-thumb.jpg",
      seed: "222",
      promptDirectives: "Version 2 directives",
      createdAt: new Date("2024-01-02"),
    },
    {
      id: "v1",
      resultUrl: "https://example.com/v1.jpg",
      thumbnailUrl: null,
      seed: "111",
      promptDirectives: null,
      createdAt: new Date("2024-01-01"),
    },
  ];

  beforeEach(() => {
    prismaRoomFindFirst.mockResolvedValue({ id: ROOM_ID });
    prismaVersionFindMany.mockResolvedValue(VERSIONS);
  });

  it("returns versions ordered by createdAt desc", async () => {
    const result = await getInpaintVersions(ROOM_ID, 0);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.versions).toEqual(VERSIONS);
    }
    expect(prismaVersionFindMany).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, variantSlot: 0 },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        resultUrl: true,
        thumbnailUrl: true,
        seed: true,
        promptDirectives: true,
        createdAt: true,
      },
    });
  });

  it("returns failure when not authenticated", async () => {
    authedUser.mockResolvedValue(null);

    const result = await getInpaintVersions(ROOM_ID, 0);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns failure when room not found or not owned", async () => {
    prismaRoomFindFirst.mockResolvedValue(null);

    const result = await getInpaintVersions(ROOM_ID, 0);

    expect(result).toEqual({ success: false, error: "Room not found or not owned by user" });
  });

  it("returns empty array when no versions exist", async () => {
    prismaVersionFindMany.mockResolvedValue([]);

    const result = await getInpaintVersions(ROOM_ID, 1);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.versions).toEqual([]);
    }
  });
});

describe("restoreInpaintVersion", () => {
  const BASE_VERSION = {
    id: VERSION_ID,
    roomId: ROOM_ID,
    variantSlot: 0,
    resultUrl: "https://example.com/old-version.jpg",
    room: {
      id: ROOM_ID,
      project: {
        id: PROJECT_ID,
        userId: USER_ID,
        clientSignatureStatus: "Pending",
      },
    },
  };

  beforeEach(() => {
    prismaVersionFindUnique.mockResolvedValue({ ...BASE_VERSION });
    prismaRoomUpdate.mockResolvedValue({ id: ROOM_ID });
  });

  it("restores version 0 to afterImageUrl", async () => {
    const result = await restoreInpaintVersion(VERSION_ID);

    expect(result).toEqual({ success: true });
    expect(prismaRoomUpdate).toHaveBeenCalledWith({
      where: { id: ROOM_ID },
      data: { afterImageUrl: "https://example.com/old-version.jpg" },
    });
  });

  it("restores version 1 to afterImageUrl2", async () => {
    prismaVersionFindUnique.mockResolvedValue({ ...BASE_VERSION, variantSlot: 1 });

    const result = await restoreInpaintVersion(VERSION_ID);

    expect(result).toEqual({ success: true });
    expect(prismaRoomUpdate).toHaveBeenCalledWith({
      where: { id: ROOM_ID },
      data: { afterImageUrl2: "https://example.com/old-version.jpg" },
    });
  });

  it("returns failure when not authenticated", async () => {
    authedUser.mockResolvedValue(null);

    const result = await restoreInpaintVersion(VERSION_ID);

    expect(result).toEqual({ success: false, error: "Not authenticated" });
  });

  it("returns failure when version not found or not owned", async () => {
    prismaVersionFindUnique.mockResolvedValue(null);

    const result = await restoreInpaintVersion(VERSION_ID);

    expect(result).toEqual({ success: false, error: "Version not found or not owned by user" });
  });

  it("returns failure when project is already signed", async () => {
    prismaVersionFindUnique.mockResolvedValue({
      ...BASE_VERSION,
      room: {
        ...BASE_VERSION.room,
        project: { ...BASE_VERSION.room.project, clientSignatureStatus: "Signed" },
      },
    });

    const result = await restoreInpaintVersion(VERSION_ID);

    expect(result).toEqual({
      success: false,
      error: "Cannot restore a version on a signed project",
    });
    expect(prismaRoomUpdate).not.toHaveBeenCalled();
  });
});
