/**
 * Issue #1337 — `<EditRoomStudio>` shell, scope/view state machine.
 *
 * Pure resolvers for the Edit Room UX redesign (Magic Patterns
 * `hVPYX2rJ2yawc1XTY2LTRJ` / design `dVy8jC2kXpi1ca8b4A1hcS`).
 *
 * Everything here is pure and pinned by `tests/edit-room-scope.test.ts`
 * (4 cases per the issue's acceptance criteria). The reducer that uses
 * `resolveTargetSlot` lives in
 * `src/components/edit-room/edit-room-reducer.ts`; this module only
 * re-exports the scope type alias and the slot resolver so that a
 * future slice can reuse it without importing the React shell.
 */

/** The three scopes the redesign surfaces. */
export type EditRoomScope = "whole-room" | "objects" | "paint";

/** Slots the canvas toolbar can be viewing. */
export type SlotId = "original" | "A" | "B";

/** Minimal `Version` shape the resolver needs. */
export interface EditRoomVersion {
  id: SlotId;
  url: string | null;
}

/**
 * Where the next inpaint run will land.
 *
 * - When `viewing` is a variant, the run is a touch-up on that variant
 *   (the design's "in place" semantics — Variant A edits Variant A).
 * - When `viewing` is `"original"`, the run lands on the first empty
 *   variant slot (A then B). When both A and B are populated we fall
 *   back to `"B"` — the design's last-resort so the user can always
 *   trigger a re-run; the slot's existing content gets overwritten.
 */
export function resolveTargetSlot({
  viewing,
  versions,
}: {
  viewing: SlotId;
  versions: ReadonlyArray<EditRoomVersion>;
}): SlotId {
  if (viewing !== "original") return viewing;
  const empty = versions.find((v) => v.id !== "original" && !v.url);
  return (empty?.id as SlotId | undefined) ?? "B";
}