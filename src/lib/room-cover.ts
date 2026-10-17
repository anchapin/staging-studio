/**
 * Issue #1194: which photo represents a room (and a project) on the
 * projects list. A staged result wins; otherwise the room's own uploaded
 * photo stands in, so a room that has been photographed but not staged yet
 * shows its photo instead of a flat placeholder block.
 *
 * Fallback order: afterImageUrl -> afterImageUrl2 -> beforeImageUrl ->
 * beforeImageUrl2 -> null. Blank strings count as missing.
 * Side effects: none (pure).
 */
export interface RoomCoverSource {
  afterImageUrl: string | null;
  afterImageUrl2: string | null;
  beforeImageUrl?: string | null;
  beforeImageUrl2?: string | null;
}

function present(url: string | null | undefined): url is string {
  return typeof url === "string" && url.trim() !== "";
}

export function roomCoverUrl(room: RoomCoverSource): string | null {
  const ordered = [room.afterImageUrl, room.afterImageUrl2, room.beforeImageUrl, room.beforeImageUrl2];
  return ordered.find(present) ?? null;
}

/**
 * Cover photo for a project card: the first room (in the order given)
 * that has any photo, using {@link roomCoverUrl}'s fallback order. Staged
 * rooms are preferred over unstaged ones so a card leads with a result
 * when one exists.
 */
export function projectCoverUrl(rooms: readonly RoomCoverSource[]): string | null {
  for (const room of rooms) {
    if (present(room.afterImageUrl) || present(room.afterImageUrl2)) return roomCoverUrl(room);
  }
  for (const room of rooms) {
    const url = roomCoverUrl(room);
    if (url) return url;
  }
  return null;
}
