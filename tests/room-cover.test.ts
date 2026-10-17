import { describe, expect, it } from "vitest";
import { projectCoverUrl, roomCoverUrl } from "@/lib/room-cover";

const empty = { afterImageUrl: null, afterImageUrl2: null, beforeImageUrl: null, beforeImageUrl2: null };

describe("roomCoverUrl (#1194)", () => {
  it("prefers the staged result", () => {
    expect(roomCoverUrl({ ...empty, afterImageUrl: "a1", beforeImageUrl: "b1" })).toBe("a1");
  });
  it("falls back to variant 2's staged result", () => {
    expect(roomCoverUrl({ ...empty, afterImageUrl2: "a2", beforeImageUrl: "b1" })).toBe("a2");
  });
  it("falls back to the uploaded photo when nothing is staged", () => {
    expect(roomCoverUrl({ ...empty, beforeImageUrl: "b1" })).toBe("b1");
    expect(roomCoverUrl({ ...empty, beforeImageUrl2: "b2" })).toBe("b2");
  });
  it("treats blank strings as missing", () => {
    expect(roomCoverUrl({ ...empty, afterImageUrl: "  ", beforeImageUrl: "b1" })).toBe("b1");
  });
  it("returns null with no photo at all", () => {
    expect(roomCoverUrl(empty)).toBeNull();
  });
  it("tolerates rows without before fields", () => {
    expect(roomCoverUrl({ afterImageUrl: null, afterImageUrl2: null })).toBeNull();
  });
});

describe("projectCoverUrl (#1194)", () => {
  it("leads with a staged room even if an earlier room only has a photo", () => {
    expect(projectCoverUrl([{ ...empty, beforeImageUrl: "b1" }, { ...empty, afterImageUrl: "a2" }])).toBe("a2");
  });
  it("uses the first uploaded photo when nothing is staged", () => {
    expect(projectCoverUrl([empty, { ...empty, beforeImageUrl: "b2" }])).toBe("b2");
  });
  it("returns null for a project with no photos", () => {
    expect(projectCoverUrl([empty, empty])).toBeNull();
    expect(projectCoverUrl([])).toBeNull();
  });
});
