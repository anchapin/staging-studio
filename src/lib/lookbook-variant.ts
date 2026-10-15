/**
 * Issue #1340 — `<VersionStrip>` + Lookbook slot.
 *
 * Pure resolver that maps the design's `SlotId` (`"original" | "A" | "B"`)
 * to the integer column stored in Prisma `Room.selectedVariantIndex`
 * (0 = Variant A, 1 = Variant B). The "Original photo" slot has no
 * variant index — the lookbook only pins to a variant, never to the
 * source photo, so it collapses to `null`.
 *
 * Lives at the lib layer (issue #1340 "Add" list) so the variant strip,
 * the API route, and the server action all stay pinned to one source of
 * truth. The reciprocal mapping is `variantIndexToSlotId` in
 * `src/components/edit-room/data.ts` — kept there because the data file
 * owns the slot↔index pairing for the whole redesign; this module owns
 * only the lookbook-direction half (slot → index) so an API caller
 * cannot accidentally use the inverse.
 */

import type { SlotId } from "@/lib/edit-room-scope";

/**
 * The valid values returned by `slotToVariantIndex`. `null` is reserved
 * for `"original"` — the lookbook cannot pin to the source photo.
 */
export type LookbookVariantIndex = 0 | 1;

/**
 * Maps a `SlotId` to the integer `Room.selectedVariantIndex` value.
 *
 * - `"A"` → `0`
 * - `"B"` → `1`
 * - `"original"` → `null` (the lookbook does not pin to the source photo)
 *
 * Exhaustive over `SlotId` — adding a new slot id is a compile error.
 */
export function slotToVariantIndex(slot: SlotId): LookbookVariantIndex | null {
  switch (slot) {
    case "A":
      return 0;
    case "B":
      return 1;
    case "original":
      return null;
  }
}

/**
 * Throws if the slot is not one of the two lookbook-pinnable variants.
 * "original" is rejected because the column stores `0 | 1 | null` and
 * `null` is reserved for "no active variant" (see `setActiveVariant`).
 *
 * Used by the server action to fail fast with a typed error before any
 * Prisma read.
 */
export function assertLookbookPinnable(slot: SlotId): asserts slot is "A" | "B" {
  if (slot !== "A" && slot !== "B") {
    throw new Error(
      `Lookbook cannot pin to slot "${slot}" — only "A" or "B" are pinnable.`
    );
  }
}
