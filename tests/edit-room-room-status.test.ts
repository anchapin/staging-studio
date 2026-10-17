import { describe, expect, it } from "vitest";

import { resolveRoomStatus, type RoomStatusInput } from "@/components/edit-room/use-room-status";

// Pin the per-room status resolver (#1338 acceptance criterion).
// Maps the Room Prisma row → Magic Patterns three-state pill.
//
// Mapping rules (canonical):
//   - No before image at all → "empty" (the design's "no photo" affordance).
//   - At least one after image populated → "staged".
//   - Before present, no after → "in-progress".
describe("resolveRoomStatus", () => {
  const empty = (): RoomStatusInput => ({
    beforeImageUrl: null,
    afterImageUrl: null,
    afterImageUrl2: null,
  });

  const withBefore = (): RoomStatusInput => ({
    ...empty(),
    beforeImageUrl: "https://x/before.jpg",
  });

  const withAfter1 = (): RoomStatusInput => ({
    ...withBefore(),
    afterImageUrl: "https://x/after.jpg",
  });

  const withAfter2 = (): RoomStatusInput => ({
    ...withAfter1(),
    afterImageUrl2: "https://x/after2.jpg",
  });

  it("returns 'empty' when the room has no images at all", () => {
    expect(resolveRoomStatus(empty())).toBe("empty");
  });

  it("returns 'in-progress' when only a before image is present (no variant yet)", () => {
    expect(resolveRoomStatus(withBefore())).toBe("in-progress");
  });

  it("returns 'staged' when variant 1 is present (afterImageUrl populated)", () => {
    expect(resolveRoomStatus(withAfter1())).toBe("staged");
  });

  it("returns 'staged' when only variant 2 is present (variant 1 empty, variant 2 filled)", () => {
    // Edge case: a room with afterImageUrl2 set but afterImageUrl null is
    // a state the schema permits (the API persists them independently).
    // The pill should still say "staged" — at least one variant exists.
    expect(
      resolveRoomStatus({
        beforeImageUrl: "https://x/before.jpg",
        afterImageUrl: null,
        afterImageUrl2: "https://x/after2.jpg",
      })
    ).toBe("staged");
  });

  it("returns 'staged' when both variants are populated", () => {
    expect(resolveRoomStatus(withAfter2())).toBe("staged");
  });
});