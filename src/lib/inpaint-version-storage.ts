import { randomUUID } from "node:crypto";

/**
 * Builds the Supabase Storage object key for an inpaint-version thumbnail.
 *
 * Issue #700: the key used to end in `${Date.now()}.jpg`, so two versions
 * saved in the same millisecond silently overwrote each other's thumbnail
 * object while both rows pointed at the surviving bytes — and deleting one
 * row's thumbnail then broke the other row's image. The key now ends in a
 * random UUID, so concurrent saves can never share a key.
 *
 * Pure; `now` is injectable for deterministic tests.
 */
export function versionThumbnailStoragePath(
  roomId: string,
  variantSlot: 0 | 1,
  now: number = Date.now()
): string {
  return `rooms/${roomId}/versions/${variantSlot}/${now}-${randomUUID()}.jpg`;
}

/**
 * Number of oldest versions the FIFO cap must evict before inserting one new
 * version (issue #700): 0 while the slot is under the cap, otherwise exactly
 * enough to bring the slot back to the cap after the insert.
 *
 * Pure arithmetic, extracted so the cap math can be pinned by
 * `tests/inpaint-version-storage.test.ts` independently of Prisma.
 */
export function fifoEvictionTake(existingCount: number, cap: number): number {
  return Math.max(0, existingCount - cap + 1);
}
