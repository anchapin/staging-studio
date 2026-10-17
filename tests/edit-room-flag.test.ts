/**
 * Issue #1344 — Feature flag resolver for the Edit Room UX redesign mount.
 *
 * `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` gates which editor surface the
 * project view mounts (legacy `<InpaintEditor>` vs new `<EditRoomStudio>`).
 * The flag is `NEXT_PUBLIC_*` because the decision is made in a client
 * component (`project-detail-view.tsx`). The resolver is the single
 * source of truth for the rule:
 *
 * - `undefined`, `""`, whitespace-only → `false` (legacy stays live).
 * - `"0"`, `"FALSE"`, `"false"`, `"no"` (case-insensitive) → `false`.
 * - `"1"`, `"TRUE"`, `"true"`, `"yes"` (case-insensitive) → `true`.
 * - Any other string → `false` (defense in depth: a typo must NOT
 *   silently flip the surface to the new editor in production).
 *
 * Pinned by the cases below so a future "we should just JSON.parse it"
 * or "trim then cast" simplification is caught by tests, not by a
 * regression in prod.
 */

import { describe, expect, it } from "vitest";

import { resolveEditRoomRedesignEnabled } from "@/lib/edit-room-flag";

describe("resolveEditRoomRedesignEnabled (issue #1344)", () => {
  it("returns false when the env value is undefined", () => {
    expect(resolveEditRoomRedesignEnabled(undefined)).toBe(false);
  });

  it("returns false when the env value is the empty string", () => {
    expect(resolveEditRoomRedesignEnabled("")).toBe(false);
  });

  it("returns false when the env value is whitespace-only", () => {
    expect(resolveEditRoomRedesignEnabled("   ")).toBe(false);
  });

  it("returns true for the exact string '1'", () => {
    expect(resolveEditRoomRedesignEnabled("1")).toBe(true);
  });

  it("returns true for 'true' (case-insensitive)", () => {
    expect(resolveEditRoomRedesignEnabled("true")).toBe(true);
    expect(resolveEditRoomRedesignEnabled("TRUE")).toBe(true);
    expect(resolveEditRoomRedesignEnabled("True")).toBe(true);
  });

  it("returns true for 'yes' (case-insensitive)", () => {
    expect(resolveEditRoomRedesignEnabled("yes")).toBe(true);
    expect(resolveEditRoomRedesignEnabled("YES")).toBe(true);
  });

  it("returns false for the exact string '0'", () => {
    expect(resolveEditRoomRedesignEnabled("0")).toBe(false);
  });

  it("returns false for 'false' (case-insensitive)", () => {
    expect(resolveEditRoomRedesignEnabled("false")).toBe(false);
    expect(resolveEditRoomRedesignEnabled("FALSE")).toBe(false);
  });

  it("returns false for 'no' (case-insensitive)", () => {
    expect(resolveEditRoomRedesignEnabled("no")).toBe(false);
  });

  it("returns false for an unrecognised value (defense in depth)", () => {
    expect(resolveEditRoomRedesignEnabled("maybe")).toBe(false);
    expect(resolveEditRoomRedesignEnabled("2")).toBe(false);
    expect(resolveEditRoomRedesignEnabled("enable")).toBe(false);
  });
});