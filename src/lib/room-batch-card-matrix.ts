/**
 * Pure status-derivation and presentation tables for the room-batch card
 * matrix (issue #707).
 *
 * `resolveRoomStatus` derives a room card's aggregate status from its two
 * variant pairs (staged when both variants have an after image,
 * in_progress when exactly one does, pending otherwise). The three
 * presentation helpers map that status onto the literal badge label,
 * badge classes, and card border classes the card renders with.
 *
 * Extracted from `src/components/canvas/room-batch-card-matrix.tsx` so the
 * component and `tests/room-batch-card-matrix.test.ts` consume a single
 * source of truth instead of the test mirroring the component's private
 * logic. Pinned 1:1 by `tests/room-batch-card-matrix.test.ts`.
 */

import type { StagedVariantPair } from "@/lib/staged-result";

/** Camera label types */
export type CameraLabel = "Cam A" | "360° Panoramic";

/** Room card status */
export type RoomCardStatus = "pending" | "in_progress" | "staged";

export function resolveRoomStatus(
  pairs: readonly [StagedVariantPair, StagedVariantPair]
): RoomCardStatus {
  const completeCount = [pairs[0], pairs[1]].filter((p) => p.after !== null).length;
  if (completeCount === 2) return "staged";
  if (completeCount === 1) return "in_progress";
  return "pending";
}

export function statusLabel(status: RoomCardStatus): string {
  if (status === "staged") return "Staged ✓";
  if (status === "in_progress") return "In Progress...";
  return "Pending";
}

export function statusBadgeClasses(status: RoomCardStatus): string {
  if (status === "staged") return "bg-tertiary/20 text-tertiary";
  if (status === "in_progress") return "bg-secondary/20 text-secondary";
  return "bg-outline/20 text-outline";
}

export function cardBorderClasses(status: RoomCardStatus): string {
  if (status === "staged") return "border-tertiary/40";
  if (status === "in_progress") return "border-secondary/40";
  return "border-outline-variant/40";
}
