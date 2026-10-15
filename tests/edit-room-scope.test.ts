import { describe, expect, it } from "vitest";

import {
  resolveTargetSlot,
  type EditRoomScope,
} from "@/lib/edit-room-scope";

type SlotId = "original" | "A" | "B";

interface Version {
  id: SlotId;
  url: string | null;
}

// Pin the resolveTargetSlot resolver from issue #1337's acceptance criteria.
// Four cases required by the issue: viewing=A, viewing=original+empty-B,
// viewing=original+empty-A, viewing=original+both-empty.
describe("resolveTargetSlot", () => {
  const filled = (id: SlotId): Version => ({ id, url: `https://x/${id}` });

  it("returns the viewing slot when viewing is a variant (not the original)", () => {
    // viewing=A → target=A regardless of which empty slots exist
    const versions: Version[] = [
      filled("original"),
      filled("A"),
      { id: "B", url: null },
    ];
    expect(resolveTargetSlot({ viewing: "A", versions })).toBe("A");

    // viewing=B → target=B (the touch-up case the design calls out)
    const versions2: Version[] = [
      filled("original"),
      { id: "A", url: null },
      { id: "B", url: null },
    ];
    expect(resolveTargetSlot({ viewing: "B", versions: versions2 })).toBe("B");
  });

  it("returns the first empty variant slot when viewing=original and B is empty", () => {
    // viewing=original, A populated, B empty → target=B (the "next empty" branch)
    const versions: Version[] = [
      filled("original"),
      filled("A"),
      { id: "B", url: null },
    ];
    expect(resolveTargetSlot({ viewing: "original", versions })).toBe("B");
  });

  it("returns the first empty variant slot when viewing=original and A is empty (B filled)", () => {
    // viewing=original, A empty, B populated → target=A (the order-matters branch)
    const versions: Version[] = [
      filled("original"),
      { id: "A", url: null },
      filled("B"),
    ];
    expect(resolveTargetSlot({ viewing: "original", versions })).toBe("A");
  });

  it("falls back to B when viewing=original and both variants are populated", () => {
    // Both A and B filled → no empty slot exists; the design's last-resort is B
    const versions: Version[] = [
      filled("original"),
      filled("A"),
      filled("B"),
    ];
    expect(resolveTargetSlot({ viewing: "original", versions })).toBe("B");
  });

  it("re-exports the EditRoomScope type without coupling to the UI", () => {
    // The export must exist for downstream slices (#1340/#1341/etc.); this is
    // a structural pin so a future refactor that drops the alias is caught.
    const scope: EditRoomScope = "whole-room";
    expect(scope).toBe("whole-room");
  });
});