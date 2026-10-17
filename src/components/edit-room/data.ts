/**
 * Issue #1337 — `<EditRoomStudio>` shell.
 *
 * Re-exports the Prisma types the new surface reads, plus the SlotId →
 * variant-index adapter the shell and the runtime share. The "data"
 * file in the Magic Patterns design (`dVy8` data.ts) holds demo image
 * URLs and stub ROOMS; we do not export those from here — child slices
 * (#1338 TopBar, #1340 VersionStrip) will replace them with real
 * `Room` + `InpaintVersion` rows read from the parent route's loader.
 *
 * Centralizing the SlotId ↔ variant-index mapping here means the
 * lookbook slot the shell exposes (`A` / `B`) and the
 * `selectedVariantIndex` column on `Room` (0 / 1) stay consistent
 * across the shell, the version strip, and the lookbook mirror.
 */

import type { SlotId } from "@/lib/edit-room-scope";

/**
 * Maps a `SlotId` to the integer column stored in Prisma
 * `Room.selectedVariantIndex`. `original` does not have an index; the
 * caller decides whether to fall back to 0 (the default).
 */
export function slotIdToVariantIndex(slot: SlotId): number | null {
  switch (slot) {
    case "A":
      return 0;
    case "B":
      return 1;
    case "original":
      return null;
  }
}

/** Inverse of `slotIdToVariantIndex`; `null` collapses to `"original"`. */
export function variantIndexToSlotId(index: number | null): SlotId {
  if (index === 0) return "A";
  if (index === 1) return "B";
  return "original";
}