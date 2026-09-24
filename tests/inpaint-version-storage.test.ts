import { describe, expect, it } from "vitest";

import {
  fifoEvictionTake,
  versionThumbnailStoragePath,
} from "@/lib/inpaint-version-storage";

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

describe("versionThumbnailStoragePath (issue #700)", () => {
  it("builds a timestamped + UUID-suffixed key under the room/slot prefix", () => {
    const path = versionThumbnailStoragePath("room-1", 0, 1_000);

    expect(path).toMatch(
      new RegExp(`^rooms/room-1/versions/0/1000-${UUID}\\.jpg$`)
    );
  });

  it("never collides across rapid successive calls in the same millisecond", () => {
    const paths = new Set(
      Array.from({ length: 200 }, () =>
        versionThumbnailStoragePath("room-1", 0, 1_234)
      )
    );

    expect(paths.size).toBe(200);
  });

  it("scopes keys per room and variant slot", () => {
    expect(versionThumbnailStoragePath("room-1", 0, 5)).toContain(
      "rooms/room-1/versions/0/"
    );
    expect(versionThumbnailStoragePath("room-2", 1, 5)).toContain(
      "rooms/room-2/versions/1/"
    );
  });
});

describe("fifoEvictionTake (issue #700)", () => {
  it("evicts nothing while the slot is under the cap", () => {
    expect(fifoEvictionTake(0, 20)).toBe(0);
    expect(fifoEvictionTake(1, 20)).toBe(0);
    expect(fifoEvictionTake(19, 20)).toBe(0);
  });

  it("evicts exactly one at the cap and catches up above it", () => {
    expect(fifoEvictionTake(20, 20)).toBe(1);
    expect(fifoEvictionTake(25, 20)).toBe(6);
    expect(fifoEvictionTake(40, 20)).toBe(21);
  });

  it("clamps non-positive results to zero", () => {
    expect(fifoEvictionTake(-3, 20)).toBe(0);
  });
});
