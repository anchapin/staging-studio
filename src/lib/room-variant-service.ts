/**
 * Room variant service (issue #939).
 *
 * Consolidates variant logic for rooms that use two A/B variant slots
 * (`selectedVariantIndex: 0 | 1 | null` on the Room model). This service
 * makes the variant operations legible and testable.
 *
 * Pure logic, pinned 1:1 by `tests/room-variant-service.test.ts`.
 */

import type { VariantSlot } from "@/lib/inpaint-source";

/** The room image fields the variant service needs (structural subset of `Room`). */
export interface VariantRoom {
  afterImageUrl: string | null;
  afterImageUrl2: string | null;
  beforeImageUrl: string | null;
  beforeImageUrl2: string | null;
  selectedVariantIndex: number | null;
}

/** The currently active variant's slot and after-image URL. */
export interface ActiveVariant {
  slot: VariantSlot;
  afterImageUrl: string;
}

/** Clone-ready data for a variant, used by room-batch.ts for batch staging. */
export interface VariantCloneData {
  afterImageUrl: string | null;
  selectedVariantIndex: number | null;
}

/** Human-readable slot name. */
export type SlotName = "variantA" | "variantB" | "original";

/**
 * Returns the currently active variant's slot and after-image URL, or null
 * when no variant is selected or the selected slot has no after image.
 */
export function getActiveVariant(room: VariantRoom): ActiveVariant | null {
  if (room.selectedVariantIndex === null) return null;
  const slot: VariantSlot = room.selectedVariantIndex === 1 ? 1 : 0;
  const url = slot === 0 ? room.afterImageUrl : room.afterImageUrl2;
  if (!url) return null;
  return { slot, afterImageUrl: url };
}

/**
 * Validates and returns the new `selectedVariantIndex`. Accepts 0, 1, or null.
 * Rejects any other value by returning null (no change).
 */
export function setActiveVariant(
  room: VariantRoom,
  index: number | null
): number | null {
  if (index === 0 || index === 1 || index === null) {
    return index;
  }
  return null;
}

/**
 * Returns clone-ready data for the currently active variant, used by room-batch.ts
 * for batch staging. Returns null when no complete variant is selected.
 */
export function cloneVariant(sourceRoom: VariantRoom): VariantCloneData | null {
  const active = getActiveVariant(sourceRoom);
  if (!active) return null;
  return {
    afterImageUrl: active.afterImageUrl,
    selectedVariantIndex: active.slot,
  };
}

/**
 * Converts a variant index to a human-readable slot name.
 * 0 → "variantA", 1 → "variantB", null → "original"
 */
export function resolveSlotFromIndex(index: number | null): SlotName {
  if (index === null) return "original";
  return index === 1 ? "variantB" : "variantA";
}

/**
 * Checks if a variant slot has a non-null afterImageUrl.
 * slot 0 checks `afterImageUrl`, slot 1 checks `afterImageUrl2`.
 */
export function isCompleteVariant(room: VariantRoom, slot: VariantSlot): boolean {
  return slot === 0 ? Boolean(room.afterImageUrl) : Boolean(room.afterImageUrl2);
}
