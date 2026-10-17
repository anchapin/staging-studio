/**
 * Feature flag for the Edit Room UX redesign (issue #1344).
 *
 * `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` is the single source of truth for
 * which staging editor surface the project detail view mounts:
 *
 * - `"0"` (default, unset, empty, whitespace) → mount the legacy
 *   `<InpaintEditor>` (the #691 subtree) so a stale deploy surfaces
 *   the working surface instead of an unfinished redesign.
 * - `"1"` (or `"true"` / `"yes"`, case-insensitive) → mount the new
 *   `<EditRoomStudio>` (the Magic Patterns redesign).
 *
 * The env var carries the `NEXT_PUBLIC_` prefix because the gate is
 * read in `project-detail-view.tsx` (a client component). The values
 * the resolver parses are deliberately narrow — any other string is
 * `false`, so a typo in a deployment env cannot silently flip the
 * surface to the redesign in production.
 *
 * Pure logic so the rule is pinned 1:1 by
 * `tests/edit-room-flag.test.ts` (issue #1344).
 */

const TRUTHY = new Set(["1", "true", "yes"]);

/**
 * Resolves the `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` env value to a boolean.
 *
 * Contract:
 * - `undefined` / `""` / whitespace-only → `false` (default off).
 * - `"1"`, `"true"`, `"yes"` (case-insensitive) → `true`.
 * - `"0"`, `"false"`, `"no"`, or any other value → `false`.
 *
 * @param value Raw env var value, or `undefined` when unset.
 * @returns Whether the redesign surface should mount.
 */
export function resolveEditRoomRedesignEnabled(
  value: string | undefined
): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return TRUTHY.has(normalized);
}