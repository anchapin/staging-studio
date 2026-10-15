/**
 * Issue #1344 — Build the `<EditRoomStudio>` prop bag from the project
 * detail view's focused-room inputs.
 *
 * The route mount (`project-detail-view.tsx`) already owns the
 * `project`, `focusedRoom`, `focusedInputs`, `directiveStatuses`,
 * `touchUps`, and in-flight run state. Wiring those into the studio
 * is a pure shape transformation — this module pins it 1:1 so the
 * route file stays thin (just spreads the resolver's return) and a
 * future prop addition only requires a fixture + test edit here, not
 * a 300-line route-file review.
 *
 * The map is intentionally narrow:
 * - `address` ← `project.propertyAddress`
 * - `roomId` / `roomName` ← `focusedRoom.id` / `focusedRoom.name`
 * - `imageUrl` ← `focusedInputs.inpaintImageUrl` (the resolved source
 *   URL — the parent route's healInpaintSource machinery picked it).
 * - `lookbookVariantUrls.A` ← `Room.afterImageUrl`
 * - `lookbookVariantUrls.B` ← `Room.afterImageUrl2`
 * - `initialLookbookSlot` ← `Room.selectedVariantIndex` mapped to
 *   `"A"` / `"B"` / `"original"` (default `"A"` per the studio's
 *   `initialEditRoomState.lookbookSlot`, mirroring the legacy
 *   `resolveStripSelection` fallback, issue #169).
 * - `aesthetic` / `globalDirectives` ← `project.stagingAesthetic` /
 *   `project.stagingDirectives`.
 * - `saveStatus` ← `directiveStatuses[roomId]` with `"idle"` default
 *   for rooms the user hasn't typed in yet.
 * - `initialCopyHeadline` / `initialCopyBody` ←
 *   `Room.lookbookHeadline` / `Room.lookbookBody`, coerced from
 *   `null | string` to `string` (the CopyPanel uses controlled
 *   `<input>` / `<textarea>` values, see #1343).
 * - `running` / `onRun` / `onExitToProject` / `touchUps` ← passed
 *   through verbatim from the route's run controller.
 */

import type { EditRoomStudioProps, SlotId } from "@/components/edit-room/types";
import type { SaveStatus } from "@/components/edit-room/types";

/** Structural subset of `Project` this resolver reads. */
export interface ProjectLike {
  id: string;
  propertyAddress: string;
  stagingAesthetic: string;
  stagingDirectives?: string | null;
}

/** Structural subset of a focused room row this resolver reads. */
export interface FocusedRoomLike {
  id: string;
  name: string;
  afterImageUrl: string | null;
  afterImageUrl2: string | null;
  selectedVariantIndex: number | null;
  lookbookHeadline?: string | null;
  lookbookBody?: string | null;
}

/** The minimal focused-inputs slice the resolver reads. */
export interface FocusedRoomInputs {
  inpaintImageUrl: string | null;
}

/** Per-slot touch-up counts the studio renders on the version strip. */
export interface TouchUpCounts {
  original: number;
  A: number;
  B: number;
}

/** Args bag the resolver accepts from the route mount. */
export interface BuildEditRoomStudioPropsArgs {
  project: ProjectLike;
  focusedRoom: FocusedRoomLike;
  focusedInputs: FocusedRoomInputs;
  directiveStatuses: Record<string, SaveStatus>;
  touchUps: TouchUpCounts;
  running: number | null;
  onRun: () => void;
  onExitToProject: () => void;
}

/**
 * Maps `Room.selectedVariantIndex` (0..1) to the studio's `SlotId`.
 * `null` → `"A"` because that's the studio's
 * `initialEditRoomState.lookbookSlot` and the legacy convention.
 */
function resolveInitialLookbookSlot(
  selectedVariantIndex: number | null
): SlotId {
  if (selectedVariantIndex === 1) return "B";
  if (selectedVariantIndex === 0) return "A";
  // null and any other value: default to A (studio's initial state).
  return "A";
}

/**
 * Pure shape transform: builds the full `EditRoomStudioProps` from the
 * route's focused-room data. See module docstring for the field map.
 */
export function buildEditRoomStudioProps(
  args: BuildEditRoomStudioPropsArgs
): EditRoomStudioProps {
  const {
    project,
    focusedRoom,
    focusedInputs,
    directiveStatuses,
    touchUps,
    running,
    onRun,
    onExitToProject,
  } = args;
  return {
    saveStatus: directiveStatuses[focusedRoom.id] ?? "idle",
    onDirectionsCommit: () => {
      // #1344 — wired by the next slice (#1344 wires the parent's
      // existing AutosaveController); for now the prop is filled
      // with a no-op so the prop shape is reviewable end-to-end.
    },
    projectId: project.id,
    roomId: focusedRoom.id,
    roomName: focusedRoom.name,
    initialLookbookSlot: resolveInitialLookbookSlot(
      focusedRoom.selectedVariantIndex
    ),
    touchUps,
    initialCopyHeadline: focusedRoom.lookbookHeadline ?? "",
    initialCopyBody: focusedRoom.lookbookBody ?? "",
    address: project.propertyAddress,
    imageUrl: focusedInputs.inpaintImageUrl ?? "",
    lookbookVariantUrls: {
      A: focusedRoom.afterImageUrl,
      B: focusedRoom.afterImageUrl2,
    },
    aesthetic: project.stagingAesthetic,
    globalDirectives: project.stagingDirectives ?? "",
    running,
    onRun,
    onExitToProject,
  };
}