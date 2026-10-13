import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(),
}));

import type { StorageClientLike } from "@/lib/storage-cleanup";
import {
  extractStoragePathFromUrl,
  isReclaimableRoomStoragePath,
  readUploadedObjectSize,
  removeStorageObjects,
} from "@/lib/storage-cleanup";

function stubClient(
  listImpl?: (...args: unknown[]) => unknown,
  removeImpl?: (...args: unknown[]) => unknown
): StorageClientLike & {
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
} {
  const from = vi.fn(() => ({
    list: vi.fn(listImpl ?? (() => Promise.resolve({ data: [], error: null }))),
    remove: vi.fn(removeImpl ?? (() => Promise.resolve({ error: null }))),
  }));
  return { storage: { from } } as never;
}

describe("extractStoragePathFromUrl", () => {
  it("extracts bucket-included path from a public object URL", () => {
    expect(
      extractStoragePathFromUrl(
        "https://ref.supabase.co/storage/v1/object/public/room-photos/batch-rooms/p1/room-0-abc.jpg"
      )
    ).toBe("room-photos/batch-rooms/p1/room-0-abc.jpg");
  });

  it("returns null for non-storage and unparseable URLs", () => {
    expect(extractStoragePathFromUrl("https://example.com/room.jpg")).toBeNull();
    expect(extractStoragePathFromUrl("not a url")).toBeNull();
  });
});

describe("isReclaimableRoomStoragePath", () => {
  it("accepts the room's own folder and the project's batch-rooms folder", () => {
    expect(
      isReclaimableRoomStoragePath("room-photos/rooms/room1/before-image.jpg", "room1", "proj1")
    ).toBe(true);
    expect(
      isReclaimableRoomStoragePath(
        "room-photos/batch-rooms/proj1/room-0-abc.jpg",
        "room1",
        "proj1"
      )
    ).toBe(true);
  });

  it("rejects another room's, another project's, or another bucket's paths", () => {
    expect(isReclaimableRoomStoragePath("room-photos/rooms/other/before-image.jpg", "room1", "proj1")).toBe(false);
    expect(isReclaimableRoomStoragePath("room-photos/batch-rooms/other/room-0-abc.jpg", "room1", "proj1")).toBe(false);
    expect(isReclaimableRoomStoragePath("staging-images/rooms/room1/x.png", "room1", "proj1")).toBe(false);
  });
});

describe("readUploadedObjectSize", () => {
  it("returns the stored size for the exact object", async () => {
    const client = stubClient(() =>
      Promise.resolve({
        data: [
          { name: "before-image.jpg", metadata: { size: 2048 } },
          { name: "other.jpg", metadata: { size: 99 } },
        ],
        error: null,
      })
    );
    await expect(
      readUploadedObjectSize(client, "room-photos", "rooms/room1/before-image.jpg")
    ).resolves.toBe(2048);
  });

  it("returns null when the object is missing, errored, or size is unreadable", async () => {
    const missing = stubClient(() => Promise.resolve({ data: [], error: null }));
    await expect(
      readUploadedObjectSize(missing, "room-photos", "rooms/room1/before-image.jpg")
    ).resolves.toBeNull();

    const errored = stubClient(() =>
      Promise.resolve({ data: null, error: { message: "boom" } })
    );
    await expect(
      readUploadedObjectSize(errored, "room-photos", "rooms/room1/before-image.jpg")
    ).resolves.toBeNull();

    const noMeta = stubClient(() =>
      Promise.resolve({ data: [{ name: "before-image.jpg", metadata: null }], error: null })
    );
    await expect(
      readUploadedObjectSize(noMeta, "room-photos", "rooms/room1/before-image.jpg")
    ).resolves.toBeNull();
  });

  it("lists the object's parent folder, not the whole bucket", async () => {
    const list = vi.fn(() => Promise.resolve({ data: [], error: null }));
    const client = { storage: { from: vi.fn(() => ({ list, remove: vi.fn() })) } } as never as StorageClientLike;
    await readUploadedObjectSize(client, "room-photos", "rooms/room1/before-image.jpg");
    expect(list).toHaveBeenCalledWith("rooms/room1", expect.objectContaining({ search: "before-image.jpg" }));
  });
});

describe("removeStorageObjects", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("@/lib/supabase");
    vi.mocked(mod.createSupabaseRequestClient).mockResolvedValue({
      storage: { from: vi.fn(() => ({ list: vi.fn(), remove: vi.fn(() => Promise.resolve({ error: null })) })) },
    } as never);
  });

  it("groups paths by bucket and removes them", async () => {
    const remove = vi.fn(() => Promise.resolve({ error: null }));
    const from = vi.fn(() => ({ list: vi.fn(), remove }));
    const mod = await import("@/lib/supabase");
    vi.mocked(mod.createSupabaseRequestClient).mockResolvedValue({
      storage: { from },
    } as never);

    await removeStorageObjects([
      "room-photos/rooms/room1/a.jpg",
      "room-photos/batch-rooms/p1/b.jpg",
    ]);

    expect(from).toHaveBeenCalledWith("room-photos");
    expect(remove).toHaveBeenCalledWith([
      "rooms/room1/a.jpg",
      "batch-rooms/p1/b.jpg",
    ]);
  });

  it("is a no-op for an empty path list", async () => {
    const mod = await import("@/lib/supabase");
    const createSpy = vi.mocked(mod.createSupabaseRequestClient);
    await removeStorageObjects([]);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("never throws when storage fails", async () => {
    const mod = await import("@/lib/supabase");
    vi.mocked(mod.createSupabaseRequestClient).mockRejectedValue(new Error("down"));
    await expect(removeStorageObjects(["room-photos/rooms/r1/a.jpg"])).resolves.toBeUndefined();
  });
});
