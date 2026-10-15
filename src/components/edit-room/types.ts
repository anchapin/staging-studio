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
  /**
   * Issue #1340 — Required by the version strip's "Use in lookbook" CTA.
   * Passed through to the `setLookbookVariant` server action so the
   * column update can attribute the write. Stubbed to `"room-1"` in
   * the shell's preview/demo surface; real values arrive in #1344
   * (parent route wiring).
   */
  projectId: string;
  /** Issue #1340 — Same context for the server action's room filter. */
  roomId: string;
  /**
   * Issue #1340 — Initial variant pinned to the lookbook, surfaced from
   * `Room.selectedVariantIndex` by the parent route. Drives the badge
   * position on the strip's first paint and the CTA's static-line state.
   */
  initialLookbookSlot: SlotId;
  /**
   * Issue #1340 — Per-slot touch-up counts surfaced from
   * `getVariantTouchUpCounts` by the parent route. Empty slots get a
   * touch-ups count of 0. The shell does not need to refetch — the
   * parent route's autosave controller handles the refresh cadence.
   */
  touchUps: { original: number; A: number; B: number };
  /**
   * Issue #1343 — Initial persisted Headline value from
   * `Room.lookbookHeadline`. Pre-populates the CopyPanel's Headline
   * input on first render; subsequent edits are shell-owned state.
   * Empty string (not `null` — the CopyPanel's `<input>` uses a
   * controlled string value) when the column is null in the DB.
   */
  initialCopyHeadline: string;
  /**
   * Issue #1343 — Initial persisted Description value from
   * `Room.lookbookBody`. Pre-populates the CopyPanel's textarea on
   * first render; subsequent edits are shell-owned state. The
   * lookbook render — via `resolveListingCopy` — falls back to the
   * legacy `recommendation` column when this is null.
   */
  initialCopyBody: string;
}

/**
 * Internal selector hook return — exported for the child slices
 * (`#1338..#1342`) to avoid prop drilling. Children re-export via
 * `useEditRoomStudioState` once they add their own state.
 */
export type { EditRoomState };