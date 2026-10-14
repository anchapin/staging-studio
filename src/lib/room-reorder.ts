/**
 * Pure logic for room reordering via drag-and-drop. Extracted so the
 * pre-#1327 dnd-kit behavior is contract-pinned for the future
 * migration to @dnd-kit/react (issue #1327 trigger conditions); the
 * current dashboard room-reorder UI in
 * src/app/(dashboard)/projects/[id]/project-detail-view.tsx consumes
 * this directly and the existing behavior must be preserved.
 *
 * No React, no JSX, no dnd-kit — pure data in / pure data out so the
 * vitest runner (environment: "node") can pin it without jsdom.
 */

export interface Identifiable {
  id: string;
}

/**
 * Splice-based reorder matching the historical in-component algorithm:
 * remove the `activeId` item from its current position and reinsert it
 * at the position of the `overId` item. Returns a new array — does not
 * mutate the input.
 *
 * Returns the input array unchanged (same identity) when the move is a
 * no-op so callers can short-circuit optimistic updates and the
 * server-persist path. The "same identity on no-op" guarantee is what
 * lets `useEffect` / memoization hooks skip downstream re-renders.
 */
export function reorderRoomsById<T extends Identifiable>(
  rooms: readonly T[],
  activeId: string,
  overId: string,
): T[] {
  // Self-over self: nothing to do. The dnd-kit callback bails here too
  // (project-detail-view.tsx:410) so the contract covers both layers.
  if (activeId === overId) return rooms as T[];

  const oldIndex = rooms.findIndex((r) => r.id === activeId);
  const newIndex = rooms.findIndex((r) => r.id === overId);

  // Either id missing means the drag event refers to a room that no
  // longer exists in the array — bail without mutation.
  if (oldIndex === -1 || newIndex === -1) return rooms as T[];

  const reordered = [...rooms];
  const [moved] = reordered.splice(oldIndex, 1);
  if (moved === undefined) return rooms as T[];
  reordered.splice(newIndex, 0, moved);
  return reordered;
}
