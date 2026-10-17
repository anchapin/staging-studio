/**
 * Issue #1338 — TopBar.
 *
 * Pure resolver: maps a Room's image columns to the Magic Patterns
 * three-state room pill (`staged` / `in-progress` / `empty`).
 *
 * Pulled into its own module so the TopBar (a presentational
 * component) stays free of domain knowledge — the parent route
 * (`#1344`/`#1345`) feeds rooms in, this module maps them to the
 * visual state.
 *
 * Pinned by `tests/edit-room-room-status.test.ts`.
 */

/** What the Room Prisma row contributes to the status decision. */
export interface RoomStatusInput {
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  afterImageUrl2: string | null;
}

/** The three states the Magic Patterns TopBar renders. */
export type RoomStatus = "staged" | "in-progress" | "empty";

/**
 * Resolve a Room's pill state.
 *
 * Mapping (documented in the test):
 * - No `beforeImageUrl` → `"empty"` (the design's "no photo" affordance).
 * - At least one of `afterImageUrl` / `afterImageUrl2` populated → `"staged"`.
 * - `beforeImageUrl` present but no after variant → `"in-progress"`.
 *
 * Why "any after populated" rather than "variant 1 only": the two
 * variant columns are populated independently by the inpaint route
 * (a stale variant-2 row after a variant-1 re-run is allowed); the
 * pill's semantic is "does this room have any staged output?".
 */
export function resolveRoomStatus(input: RoomStatusInput): RoomStatus {
  if (!input.beforeImageUrl) return "empty";
  if (input.afterImageUrl || input.afterImageUrl2) return "staged";
  return "in-progress";
}