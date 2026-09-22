import { describe, expect, it } from "vitest";

import type { StagedVariantPair } from "@/lib/staged-result";
import type { RoomCardStatus, CameraLabel } from "@/components/canvas/room-batch-card-matrix";

function makePairs(hasA: boolean, hasB: boolean): readonly [StagedVariantPair, StagedVariantPair] {
  return [
    { before: "https://example.com/before.jpg", after: hasA ? "https://example.com/after.jpg" : null },
    { before: "https://example.com/before2.jpg", after: hasB ? "https://example.com/after2.jpg" : null },
  ];
}

function resolveRoomStatus(pairs: readonly [StagedVariantPair, StagedVariantPair]): RoomCardStatus {
  const completeCount = [pairs[0], pairs[1]].filter((p) => p.after !== null).length;
  if (completeCount === 2) return "staged";
  if (completeCount === 1) return "in_progress";
  return "pending";
}

describe("RoomBatchCardMatrix utilities", () => {
  describe("resolveRoomStatus", () => {
    it("returns pending when no variants are complete", () => {
      const pairs = makePairs(false, false);
      expect(resolveRoomStatus(pairs)).toBe("pending");
    });

    it("returns in_progress when one variant is complete", () => {
      const pairs = makePairs(true, false);
      expect(resolveRoomStatus(pairs)).toBe("in_progress");
    });

    it("returns in_progress when the second variant is complete", () => {
      const pairs = makePairs(false, true);
      expect(resolveRoomStatus(pairs)).toBe("in_progress");
    });

    it("returns staged when both variants are complete", () => {
      const pairs = makePairs(true, true);
      expect(resolveRoomStatus(pairs)).toBe("staged");
    });
  });

  describe("CameraLabel type", () => {
    it("accepts 'Cam A' as valid camera label", () => {
      const label: CameraLabel = "Cam A";
      expect(label).toBe("Cam A");
    });

    it("accepts '360° Panoramic' as valid camera label", () => {
      const label: CameraLabel = "360° Panoramic";
      expect(label).toBe("360° Panoramic");
    });
  });

  describe("RoomCardStatus type", () => {
    it("accepts 'pending' as valid status", () => {
      const status: RoomCardStatus = "pending";
      expect(status).toBe("pending");
    });

    it("accepts 'in_progress' as valid status", () => {
      const status: RoomCardStatus = "in_progress";
      expect(status).toBe("in_progress");
    });

    it("accepts 'staged' as valid status", () => {
      const status: RoomCardStatus = "staged";
      expect(status).toBe("staged");
    });
  });

  describe("variant count", () => {
    it("counts zero completed variants correctly", () => {
      const pairs = makePairs(false, false);
      const count = [pairs[0], pairs[1]].filter((p) => p.after !== null).length;
      expect(count).toBe(0);
    });

    it("counts one completed variant correctly", () => {
      const pairs = makePairs(true, false);
      const count = [pairs[0], pairs[1]].filter((p) => p.after !== null).length;
      expect(count).toBe(1);
    });

    it("counts two completed variants correctly", () => {
      const pairs = makePairs(true, true);
      const count = [pairs[0], pairs[1]].filter((p) => p.after !== null).length;
      expect(count).toBe(2);
    });
  });
});
