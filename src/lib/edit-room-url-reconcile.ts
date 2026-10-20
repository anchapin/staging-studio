/**
 * Issue #1376 — Re-sync server-truth URL/selection fields onto a local
 * `project` snapshot after `router.refresh()`.
 *
 * Why this lives in its own module:
 * - `<ProjectDetailView>` keeps a `useState(initialProject)` projection of
 *   the server payload for optimistic mutations (room reorder, staging-
 *   package toggles, etc.). `useState` only consumes the initializer on
 *   mount, so subsequent re-renders driven by `revalidatePath()` plus
 *   `router.refresh()` never reach that state — which makes server-side
 *   mutations made from inside `<EditRoomStudio>` (variant delete in
 *   particular) appear stale on the version strip until a full page
 *   reload.
 * - The fix is a targeted `useEffect` that adopts three server-only
 *   fields (`afterImageUrl`, `afterImageUrl2`, `selectedVariantIndex`)
 *   onto the local snapshot. These fields have no local optimistic
 *   writer, so adopting them on prop change is safe; everything else
 *   (room order, lock state, mutations) keeps flowing through the
 *   existing `applyRoomUpdate`/`setProject((prev) => …)` paths.
 * - Extracting `mergeServerUrlFields` as a pure function lets us pin
 *   the merge semantics in a vitest unit test (#1376) without rendering
 *   the React tree.
 *
 * Public API:
 * - `mergeServerUrlFields(localProject, initialProject)` — pure, generic
 *   in `T extends { rooms: MergeableRoom[] }` so the caller stays
 *   structurally typed.
 */

export interface MergeableRoom {
  id: string;
  afterImageUrl?: string | null;
  afterImageUrl2?: string | null;
  selectedVariantIndex?: number | null;
}

export interface MergeableProject {
  rooms: MergeableRoom[];
}

/**
 * Adopt each room's three server-only URL/selection fields onto the local
 * snapshot, room-by-room. Other room fields are preserved untouched so
 * optimistic local mutations (reorder, lock state, etc.) survive the
 * `router.refresh()` cycle.
 *
 * Distinguishing "server explicitly cleared the slot" (`null`) from
 * "server omitted the field" is load-bearing: variant delete writes
 * `null`, and adopting `null` here is the only thing that actually
 * removes the variant's delete button from the strip within the
 * Playwright 20-second polling window.
 */
export function mergeServerUrlFields<T extends MergeableProject>(
  localProject: T,
  initialProject: T,
): T {
  const serverByRoomId = new Map<MergeableRoom["id"], MergeableRoom>(
    initialProject.rooms.map((r) => [r.id, r]),
  );
  const mergedRooms = localProject.rooms.map((localRoom) => {
    const serverRoom = serverByRoomId.get(localRoom.id);
    if (!serverRoom) return localRoom;
    return {
      ...localRoom,
      afterImageUrl: adoptUrlField(serverRoom.afterImageUrl, localRoom.afterImageUrl),
      afterImageUrl2: adoptUrlField(serverRoom.afterImageUrl2, localRoom.afterImageUrl2),
      selectedVariantIndex: adoptSelectedVariant(
        serverRoom.selectedVariantIndex,
        localRoom.selectedVariantIndex,
      ),
    };
  });
  return { ...localProject, rooms: mergedRooms };
}

function adoptUrlField(
  serverValue: string | null | undefined,
  localValue: string | null | undefined,
): string | null | undefined {
  if (serverValue === null) return null;
  if (serverValue === undefined) return localValue;
  return serverValue;
}

function adoptSelectedVariant(
  serverValue: number | null | undefined,
  localValue: number | null | undefined,
): number | null | undefined {
  if (serverValue === null || serverValue === undefined) return localValue;
  return serverValue;
}
