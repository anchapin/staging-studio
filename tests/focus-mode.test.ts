import { describe, expect, it } from "vitest";
import {
  resolveFocusedRoom,
  resolveRoomLayoutMode,
} from "@/lib/focus-mode";

/**
 * Focused single-room editing (issue #169): the requested `editorRoomId`
 * must own the focused view only while it still matches a real room, and
 * the layout falls back to the all-rooms grid for every other case.
 */
interface StubRoom {
  id: string;
  name: string;
}

const ROOMS: StubRoom[] = [
  { id: "room-a", name: "Living Room" },
  { id: "room-b", name: "Kitchen" },
];

describe("resolveFocusedRoom", () => {
  it("returns the room matching the requested id", () => {
    expect(resolveFocusedRoom(ROOMS, "room-b")).toEqual(ROOMS[1]);
    expect(resolveFocusedRoom(ROOMS, "room-a")).toEqual(ROOMS[0]);
  });

  it("returns null when no focus is requested", () => {
    expect(resolveFocusedRoom(ROOMS, null)).toBeNull();
    expect(resolveFocusedRoom(ROOMS, undefined)).toBeNull();
  });

  it("returns null for a stale id (room no longer exists)", () => {
    expect(resolveFocusedRoom(ROOMS, "room-deleted")).toBeNull();
  });

  it("matches whole ids only, never prefixes", () => {
    expect(resolveFocusedRoom(ROOMS, "room-")).toBeNull();
    expect(resolveFocusedRoom(ROOMS, "room-a-extra")).toBeNull();
  });

  it("returns null when the project has no rooms", () => {
    expect(resolveFocusedRoom([], "room-a")).toBeNull();
  });
});

describe("resolveRoomLayoutMode", () => {
  it("is focused when the requested id resolves to a real room", () => {
    expect(resolveRoomLayoutMode(ROOMS, "room-a")).toBe("focused");
  });

  it("is grid when nothing is requested", () => {
    expect(resolveRoomLayoutMode(ROOMS, null)).toBe("grid");
    expect(resolveRoomLayoutMode(ROOMS, undefined)).toBe("grid");
  });

  it("is grid for a stale id (fall back to all rooms)", () => {
    expect(resolveRoomLayoutMode(ROOMS, "room-deleted")).toBe("grid");
  });

  it("is grid when the project has no rooms", () => {
    expect(resolveRoomLayoutMode([], "room-a")).toBe("grid");
  });
});
