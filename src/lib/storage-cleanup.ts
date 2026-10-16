/**
 * Storage hygiene helpers for the `room-photos` bucket (issue #1145).
 *
 * Two problems this module exists for:
 *
 * 1. Signed upload URLs carry no size constraint (Supabase's
 *    `createSignedUploadUrl` accepts no limit), so an authenticated
 *    account could PUT arbitrarily large bodies. The constraint is
 *    therefore enforced server-side at confirm, where the object
 *    actually exists and its metadata size is readable.
 * 2. Uploads minted at fresh random paths (`batch-rooms/**` with a
 *    per-round UUID) had no reclaim path: `deleteRoom` dropped DB rows
 *    without touching storage, so orphans accumulated invisibly in a
 *    public bucket (~$0.021/GB-month beyond the included tier).
 *
 * All cleanup helpers are BEST-EFFORT: a storage failure is logged and
 * never propagates, mirroring the evicted-thumbnail cleanup in
 * `inpaint-versions.ts` — losing a DB delete to a storage error would
 * be far worse than leaving an orphan behind.
 */
import { createSupabaseRequestClient } from "@/lib/supabase";

/**
 * Max accepted size for one uploaded room photo, in bytes.
 * Matches the client's own compression ceiling (`maxSizeMB: 10` in
 * `batch-room-upload.tsx`), so a compliant client never trips this
 * while a raw oversized PUT is rejected.
 */
export const MAX_ROOM_PHOTO_BYTES = 10 * 1024 * 1024;

/** Bucket every room photo and batch upload lands in. */
export const ROOM_PHOTOS_BUCKET = "room-photos";

/**
 * Minimal structural type for the Supabase Storage surface this module
 * uses, so tests can pass a narrow stub instead of the full client.
 */
export interface StorageClientLike {
  storage: {
    from(bucket: string): {
      list(
        folder: string,
        options?: { search?: string; limit?: number; offset?: number }
      ): Promise<{
        data: Array<{ name: string; metadata?: { size?: number } | null }> | null;
        error: { message: string } | null;
      }>;
      remove(paths: string[]): Promise<{ error: { message: string } | null }>;
    };
  };
}

/**
 * Extracts a storage path from a Supabase public object URL.
 * `https://xxx.supabase.co/storage/v1/object/public/room-photos/rooms/...`
 * → `room-photos/rooms/...` (bucket included), or `null` when the URL
 * does not point into Supabase Storage. Mirrors the extraction in
 * `inpaint-versions.ts`.
 */
export function extractStoragePathFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split("/storage/v1/object/public/");
    return pathParts[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * True when the extracted path belongs to this project's reclaimable
 * surface: the room's own `rooms/{roomId}/` folder or the project's
 * `batch-rooms/{projectId}/` folder. Guards deleteRoom against
 * deleting objects a URL coincidentally points at elsewhere.
 */
export function isReclaimableRoomStoragePath(
  path: string,
  roomId: string,
  projectId: string
): boolean {
  const escapedRoomId = roomId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedProjectId = projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^room-photos/(?:rooms/${escapedRoomId}/|batch-rooms/${escapedProjectId}/)`
  );
  return pattern.test(path);
}

/**
 * Reads the stored size of an uploaded object from its folder listing.
 * Returns the size in bytes, or `null` when the object is missing or
 * its size is unreadable (in which case callers must NOT treat the
 * upload as oversized — a missing object fails confirm downstream
 * anyway when its URL 404s).
 */
export async function readUploadedObjectSize(
  supabase: StorageClientLike,
  bucket: string,
  storagePath: string
): Promise<number | null> {
  const lastSlash = storagePath.lastIndexOf("/");
  const folder = lastSlash === -1 ? "" : storagePath.slice(0, lastSlash);
  const fileName = lastSlash === -1 ? storagePath : storagePath.slice(lastSlash + 1);

  const { data, error } = await supabase.storage.from(bucket).list(folder, {
    search: fileName,
    limit: 100,
  });
  if (error || !data) return null;
  // The storage list response is typed as an array, but a misbehaving
  // backend (or a stub) can return a non-iterable shape — e.g. the
  // hermetic e2e mock's storage responder, which has no
  // /object/list/<bucket> handler, so supabase-js hands back a
  // non-array `data`. Calling `.find` on that would surface as
  // `TypeError: data.find is not a function` in `confirmRoomPhotoUpload`
  // and fail the entire upload with that string in the user's UI. Treat
  // any non-array response as "no match" and let the upload fall
  // through to the downstream size check (the linked URL 404s if the
  // object is actually missing).
  if (!Array.isArray(data)) return null;

  const match = data.find((entry) => entry.name === fileName);
  if (!match || !match.metadata || typeof match.metadata.size !== "number") {
    return null;
  }
  return match.metadata.size;
}

/**
 * Best-effort delete of storage objects by bucket-relative path
 * (bucket included, e.g. `room-photos/rooms/x/before-image.jpg`).
 * Never throws; logs on failure.
 */
export async function removeStorageObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  try {
    const byBucket = new Map<string, string[]>();
    for (const path of paths) {
      const slash = path.indexOf("/");
      if (slash <= 0) continue;
      const bucket = path.slice(0, slash);
      const objectPath = path.slice(slash + 1);
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), objectPath]);
    }

    const supabase = (await createSupabaseRequestClient()) as StorageClientLike;
    for (const [bucket, objectPaths] of byBucket) {
      const { error } = await supabase.storage.from(bucket).remove(objectPaths);
      if (error) {
        console.error(
          `[storage-cleanup] failed to remove ${objectPaths.length} object(s) from ${bucket}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error("[storage-cleanup] storage cleanup failed:", error);
  }
}
