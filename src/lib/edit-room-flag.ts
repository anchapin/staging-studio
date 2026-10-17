/**
 * Kill-switch for the Edit Room UX redesign (#1344 / #1346 wave-5).
 *
 * After issue #1346, the `<EditRoomStudio>` (Magic Patterns redesign) is
 * the ONLY mounted editor — the legacy `<InpaintEditor>` and
 * `<RefineStudioClient>` are slated for deletion in this same PR. To
 * give operators a single-line escape hatch while the delete pass is in
 * flight, `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` is still honored: set it to
 * `"0"` / `"false"` / `"no"` to re-enable the legacy mount. Default
 * (unset / `"1"` / anything truthy) keeps the new studio.
 *
 * Once issue #1346 lands the entire `edit-room-flag.ts` module and the
 * env var are retired (wave-5 commit 3) — this file is intentionally
 * short-lived. Pure logic so the rule is pinned 1:1 by
 * `tests/edit-room-flag.test.ts` (#1344 / #1346).
 */

const FALSY = new Set(["0", "false", "no", "off", "disable", "disabled"]);

/**
 * Resolves the `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` env value to a boolean.
 *
 * Contract (inverted from the pre-#1346 gate, default is now ON):
 * - `undefined` / `""` / whitespace-only → `true` (default ON).
 * - `"0"`, `"false"`, `"no"`, `"off"`, `"disable"`, `"disabled"`
 *   (case-insensitive) → `false` (opt OUT to the legacy mount).
 * - Any other value → `true` (treat typos as ON so a stale deploy
 *   cannot accidentally keep the legacy surface).
 *
 * @param value Raw env var value, or `undefined` when unset.
 * @returns Whether the redesign surface should mount.
 */
export function resolveEditRoomRedesignEnabled(
  value: string | undefined
): boolean {
  if (value === undefined) return true;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return !FALSY.has(normalized);
}