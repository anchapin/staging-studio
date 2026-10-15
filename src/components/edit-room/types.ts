/**
 * Issue #1337 — `<EditRoomStudio>` shell.
 *
 * Public types for the Edit Room UX redesign. Re-exports the lib-level
 * scope/slot aliases so consumers (top-bar, canvas-stage, inspector)
 * can import from one place; everything else here is the local
 * component-prop shape the Magic Patterns code uses.
 */

import type { SlotId } from "@/lib/edit-room-scope";
import type { EditRoomState } from "@/components/edit-room/edit-room-reducer";

export type { EditRoomScope, SlotId, EditRoomVersion } from "@/lib/edit-room-scope";

/** Save status mirrored from the parent route's AutosaveController. */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Shape of one variant slot the version strip renders. Mirrors the
 * Magic Patterns `Version` type but typed against the Prisma
 * `selectedVariantIndex` (0/1 → "A"/"B"). The reducer test in
 * `tests/edit-room-reducer.test.ts` does not depend on this type;
 * slice #1340 will pin the version-strip against it.
 */
export interface Version {
  id: SlotId;
  label: string;
  url: string | null;
  touchUps: number;
}

/**
 * The shell's prop contract — every prop the parent route (or a
 * future storybook preview) must supply. The shell itself owns the
 * rest of the state via `useReducer` (see
 * `edit-room-reducer.ts`); `saveStatus` is the one exception (the
 * AutosaveController lives at the route level, not inside the shell).
 */
export interface EditRoomStudioProps {
  /** Auto-save status mirrored from the parent route's AutosaveController. */
  saveStatus: SaveStatus;
  /** Fired 900ms after the user stops typing in the directions textarea. */
  onDirectionsCommit: (value: string) => void;
}

/**
 * Internal selector hook return — exported for the child slices
 * (`#1338..#1342`) to avoid prop drilling. Children re-export via
 * `useEditRoomStudioState` once they add their own state.
 */
export type { EditRoomState };