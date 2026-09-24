import { describe, expect, it } from "vitest";

import type { StagedVariantPair } from "@/lib/staged-result";
import {
  cardBorderClasses,
  resolveRoomStatus,
  statusBadgeClasses,
  statusLabel,
} from "@/lib/room-batch-card-matrix";
import type { RoomCardStatus } from "@/lib/room-batch-card-matrix";

function makePairs(hasA: boolean, hasB: boolean): readonly [StagedVariantPair, StagedVariantPair] {
  return [
    { before: "https://example.com/before.jpg", after: hasA ? "https://example.com/after.jpg" : null },
    { before: "https://example.com/before2.jpg", after: hasB ? "https://example.com/after2.jpg" : null },
  ];
}

/**
 * Compile-time exhaustiveness guard: `Record<RoomCardStatus, …>` fixtures
 * fail to typecheck if a new union member is added without extending them,
 * so a new status can never silently miss coverage.
 */
const EXPECTED_LABELS: Record<RoomCardStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress...",
  staged: "Staged ✓",
};

const EXPECTED_BADGE_CLASSES: Record<RoomCardStatus, string> = {
  pending: "bg-outline/20 text-outline",
  in_progress: "bg-secondary/20 text-secondary",
  staged: "bg-tertiary/20 text-tertiary",
};

const EXPECTED_BORDER_CLASSES: Record<RoomCardStatus, string> = {
  pending: "border-outline-variant/40",
  in_progress: "border-secondary/40",
  staged: "border-tertiary/40",
};

describe("RoomBatchCardMatrix utilities", () => {
  describe("resolveRoomStatus", () => {
    it("returns pending when no variants are complete", () => {
      expect(resolveRoomStatus(makePairs(false, false))).toBe("pending");
    });

    it("returns in_progress when one variant is complete", () => {
      expect(resolveRoomStatus(makePairs(true, false))).toBe("in_progress");
    });

    it("returns in_progress when the second variant is complete", () => {
      expect(resolveRoomStatus(makePairs(false, true))).toBe("in_progress");
    });

    it("returns staged when both variants are complete", () => {
      expect(resolveRoomStatus(makePairs(true, true))).toBe("staged");
    });

    it("covers every RoomCardStatus member across the full input matrix", () => {
      // All four (hasA, hasB) input combinations, each mapped to exactly one
      // status: pending ← 1 combination, in_progress ← 2, staged ← 1. A deep
      // equal against this tally fails if any union member stops being
      // produced — or if an unknown status ever escapes the union.
      const results = [
        resolveRoomStatus(makePairs(false, false)),
        resolveRoomStatus(makePairs(true, false)),
        resolveRoomStatus(makePairs(false, true)),
        resolveRoomStatus(makePairs(true, true)),
      ];
      const expectedTally: Record<RoomCardStatus, number> = {
        pending: 1,
        in_progress: 2,
        staged: 1,
      };
      const tally = results.reduce<Record<string, number>>((acc, status) => {
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
      }, {});
      expect(tally).toEqual(expectedTally);
    });
  });

  describe("status presentation tables", () => {
    it("maps every RoomCardStatus to its literal badge label", () => {
      for (const status of Object.keys(EXPECTED_LABELS) as RoomCardStatus[]) {
        expect(statusLabel(status)).toBe(EXPECTED_LABELS[status]);
      }
    });

    it("maps every RoomCardStatus to its literal badge classes", () => {
      for (const status of Object.keys(EXPECTED_BADGE_CLASSES) as RoomCardStatus[]) {
        expect(statusBadgeClasses(status)).toBe(EXPECTED_BADGE_CLASSES[status]);
      }
    });

    it("maps every RoomCardStatus to its literal card border classes", () => {
      for (const status of Object.keys(EXPECTED_BORDER_CLASSES) as RoomCardStatus[]) {
        expect(cardBorderClasses(status)).toBe(EXPECTED_BORDER_CLASSES[status]);
      }
    });
  });
});
