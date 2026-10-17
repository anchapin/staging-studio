import { describe, expect, it } from "vitest";

import {
  ROOM_TYPE_OTHER_LABEL,
  isUsableRoomTypeLabel,
  shouldAutoClassifyRoomName,
} from "@/lib/auto-classify-room";

describe("shouldAutoClassifyRoomName (issue #1180)", () => {
  it("classifies when the room name is empty", () => {
    expect(shouldAutoClassifyRoomName("")).toBe(true);
  });

  it("classifies when the room name is whitespace only", () => {
    expect(shouldAutoClassifyRoomName("   ")).toBe(true);
    expect(shouldAutoClassifyRoomName("\t\n")).toBe(true);
  });

  it("classifies when the room name is the 'Other' placeholder", () => {
    expect(shouldAutoClassifyRoomName(ROOM_TYPE_OTHER_LABEL)).toBe(true);
    expect(shouldAutoClassifyRoomName("  Other  ")).toBe(true);
    expect(shouldAutoClassifyRoomName("other")).toBe(false); // case-sensitive
  });

  it("does NOT classify when the room has a user-typed name", () => {
    expect(shouldAutoClassifyRoomName("Living Room")).toBe(false);
    expect(shouldAutoClassifyRoomName("Primary Bedroom")).toBe(false);
    expect(shouldAutoClassifyRoomName("Room 1")).toBe(false);
    expect(shouldAutoClassifyRoomName("Den")).toBe(false);
  });
});

describe("isUsableRoomTypeLabel (issue #1180)", () => {
  it("rejects the 'Other' low-confidence sentinel", () => {
    expect(isUsableRoomTypeLabel(ROOM_TYPE_OTHER_LABEL)).toBe(false);
    expect(isUsableRoomTypeLabel("  Other  ")).toBe(false);
  });

  it("rejects empty/whitespace labels", () => {
    expect(isUsableRoomTypeLabel("")).toBe(false);
    expect(isUsableRoomTypeLabel("   ")).toBe(false);
  });

  it("accepts concrete room-type labels", () => {
    expect(isUsableRoomTypeLabel("Living Room")).toBe(true);
    expect(isUsableRoomTypeLabel("Primary Bedroom")).toBe(true);
    expect(isUsableRoomTypeLabel("Kitchen")).toBe(true);
    expect(isUsableRoomTypeLabel("  Bathroom  ")).toBe(true);
  });
});