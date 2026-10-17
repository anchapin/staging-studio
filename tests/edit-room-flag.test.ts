/**
 * Issue #1346 — the `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` env var is
 * now a kill-switch (default ON, opt OUT to legacy). Test the new
 * contract: every input resolves to `true` EXCEPT the explicit
 * falsy set, which resolves to `false`.
 *
 * Pre-#1346 the gate was default-OFF; the inversion is the whole
 * point of this commit (wave-5 of the Edit Room UX redesign).
 */
import { describe, expect, it } from "vitest";
import { resolveEditRoomRedesignEnabled } from "@/lib/edit-room-flag";

describe("resolveEditRoomRedesignEnabled (#1346 kill-switch, default ON)", () => {
  it("returns true when env is undefined (default ON after #1346)", () => {
    expect(resolveEditRoomRedesignEnabled(undefined)).toBe(true);
  });

  it("returns true for empty / whitespace-only values", () => {
    expect(resolveEditRoomRedesignEnabled("")).toBe(true);
    expect(resolveEditRoomRedesignEnabled("   ")).toBe(true);
  });

  it("returns true for the original truthy set (back-compat with #1344)", () => {
    expect(resolveEditRoomRedesignEnabled("1")).toBe(true);
    expect(resolveEditRoomRedesignEnabled("true")).toBe(true);
    expect(resolveEditRoomRedesignEnabled("yes")).toBe(true);
  });

  it("treats unknown values as ON so a typo cannot flip to legacy", () => {
    expect(resolveEditRoomRedesignEnabled("enable")).toBe(true);
    expect(resolveEditRoomRedesignEnabled("on")).toBe(true);
    expect(resolveEditRoomRedesignEnabled("foo")).toBe(true);
  });

  it("returns false ONLY for the explicit falsy kill-switch set", () => {
    expect(resolveEditRoomRedesignEnabled("0")).toBe(false);
    expect(resolveEditRoomRedesignEnabled("false")).toBe(false);
    expect(resolveEditRoomRedesignEnabled("no")).toBe(false);
    expect(resolveEditRoomRedesignEnabled("off")).toBe(false);
    expect(resolveEditRoomRedesignEnabled("disable")).toBe(false);
    expect(resolveEditRoomRedesignEnabled("disabled")).toBe(false);
  });

  it("normalises case and surrounding whitespace", () => {
    expect(resolveEditRoomRedesignEnabled(" FALSE ")).toBe(false);
    expect(resolveEditRoomRedesignEnabled("0")).toBe(false);
    expect(resolveEditRoomRedesignEnabled(" 1 ")).toBe(true);
  });
});
