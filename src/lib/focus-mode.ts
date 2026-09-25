/**
 * Focused single-room editing (issue #169).
 *
 * The project detail view holds a single `editorRoomId`; the helpers here
 * resolve, from that state and the project's rooms, which room owns the
 * full-width focused editing view and whether the page renders the
 * all-rooms grid or the focused editor at all. Because the editor state is
 * a single id, opening a second room's editor always replaces the first —
 * one editor at a time by construction.
 *
 * Pure logic so the stale-id fallback and layout selection are pinned 1:1
 * by `tests/focus-mode.test.ts`.
 */

/** Which layout the project detail view renders. */
export type RoomLayoutMode = "grid" | "focused";

/**
 * Resolves the room that owns the focused editor. Returns null when no
 * focus was requested — or when the requested id no longer matches a room
 * (e.g. the room disappeared after a refetch while focused). A stale id
 * must fall back to the all-rooms grid, never render a dead editor.
 */
export function resolveFocusedRoom<T extends { id: string }>(
  rooms: readonly T[],
  requestedId: string | null | undefined
): T | null {
  if (!requestedId) return null;
  return rooms.find((room) => room.id === requestedId) ?? null;
}

/**
 * "focused" only when the requested id resolves to a real room; anything
 * else (no request, unknown id, empty room list) renders the all-rooms
 * grid.
 */
export function resolveRoomLayoutMode<T extends { id: string }>(
  rooms: readonly T[],
  requestedId: string | null | undefined
): RoomLayoutMode {
  return resolveFocusedRoom(rooms, requestedId) ? "focused" : "grid";
}
