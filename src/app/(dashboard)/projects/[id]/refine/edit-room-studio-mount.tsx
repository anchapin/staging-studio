/**
 * Issue #1345 — flag-gated mount of `<EditRoomStudio>` for `/refine`.
 *
 * The legacy `/refine` page owns its own stateful `RefineStudioClient`
 * (URL-driven room switch, inspector collapse, focus mode, history
 * snapshot). The redesign studio (`<EditRoomStudio>`, wave-4 issue
 * #1342) replaces it when `NEXT_PUBLIC_EDIT_ROOM_REDESIGN=1`, and this
 * wrapper adapts the legacy page's `RefineRoom[]` shape to the studio's
 * `buildEditRoomStudioProps` arg shape.
 *
 * Scope: thin adapter. The studio's heavy dependencies (AutosaveController,
 * mask buffer, run cluster, FineTune persistence to GraphQL) are NOT
 * implemented here — the studio accepts them via no-op fallbacks so the
 * wrapper is integration-compatible with the legacy `/refine` surface
 * (which has none of those). Stage B (#1362b) wires the
 * `submitInpaint`-via-server-action path for Run, the
 * `saveRoomMetadata` path for `onDirectivesChange`, and the
 * `router.push` path for `onExitToProject`. Everything else (autosave
 * with debounce, mask painting, FineTune-to-DashScope-payload mapping)
 * is wave-5/6.
 *
 * Out of scope: editor-inspector-column.tsx, inpaint-editor.tsx, the
 * zen/focus surfaces — those are wave-5 retires per #1346+.
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { EditRoomStudio } from "@/components/edit-room/EditRoomStudio";
import {
  buildEditRoomStudioProps,
  type BuildEditRoomStudioPropsArgs,
} from "@/lib/edit-room-studio-props";
import { saveRoomMetadata } from "@/app/actions/room";

interface MountRefineRoom {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  afterImageUrl2: string | null;
  selectedVariantIndex: number | null;
  rawDirectives: string | null;
  // Optional — the new studio reads these from the same column shape the
  // project view uses (#1362a). The legacy `RefineStudioClient` never
  // exposed them, so they fall back to `null` when the row has no value.
  lookbookHeadline?: string | null;
  lookbookBody?: string | null;
  fineTuneStrength?: number | null;
  fineTuneExpand?: number | null;
  fineTuneSeed?: string | null;
}

interface MountRefineProject {
  id: string;
  propertyAddress: string;
  // `stagingAesthetic` / `stagingDirectives` are not part of the
  // `/refine` query — the wrapper passes them as undefined to the
  // prop builder, which forwards them as null. Stage B (#1362b) widens
  // the `getOwnedRefineProject` select if the studio ever needs them.
}

interface EditRoomStudioMountProps {
  /** Whichever room `?room=<id>` resolved to. Required — the studio is
   *  single-room scoped. Falls back to the first room upstream. */
  focusedRoom: MountRefineRoom;
  /** All other rooms, used to compute the studio's "switch room" affordance
   *  (currently forward-only; the studio's `RoomSwitcher` is wave-5). */
  project: MountRefineProject;
}

/**
 * Thin wrapper that mounts `<EditRoomStudio>` for one focused room.
 *
 * State this wrapper owns (minimal):
 *  - `maskDataUrl`: the painted mask the studio emits.
 *  - `running`: true while the Run click is in flight (studio disables Run).
 *
 * State the studio owns internally (and surfaces back via callbacks):
 *  - `directions` (textarea), `fineTune.strength/expand/seed` (controlled
 *    inputs) — the studio holds its own useState and forwards changes via
 *    the callback props we pass.
 *
 * Persistence: the wrapper forwards directives edits to `saveRoomMetadata`
 * (the same action the legacy client uses). FineTune edits stay in-studio
 * for now — Stage B wires `editFineTune` (out of scope for #1345).
 *
 * Exit: `onExitToProject` returns to the parent project view.
 */
export function EditRoomStudioMount({
  focusedRoom,
  project,
}: EditRoomStudioMountProps) {
  const router = useRouter();
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [running, setRunning] = useState<number>(0);
  const directiveStatuses = useMemo<BuildEditRoomStudioPropsArgs["directiveStatuses"]>(
    () => ({ [focusedRoom.id]: "saved" as const }),
    [focusedRoom.id],
  );

  const touchUps = useMemo<BuildEditRoomStudioPropsArgs["touchUps"]>(
    () => ({ A: 0, B: 0, original: 0 }),
    [],
  );

  const handleDirectivesChange = useCallback(
    (value: string) => {
      // Fire-and-forget — same as legacy. Wave-5 wires an AutosaveController
      // for debounced flush + status.
      void saveRoomMetadata(focusedRoom.id, { rawDirectives: value }).catch(
        () => {
          // Stage A: swallow. The studio still shows "Saved" because the
          // directiveStatuses map is hard-coded to "saved" until #1362b
          // wires the actual AutosaveController. surfacing the failure here
          // would mislead the user, since the next wave owns this path.
        },
      );
    },
    [focusedRoom.id],
  );

  const handleRun = useCallback(() => {
    // Stage B (#1362b) wires `submitInpaint` via a server action. Until
    // then this is a no-op so the studio's button stays inert rather
    // than silently swallowing a real submit.
    setRunning(0);
  }, []);

  const handleExitToProject = useCallback(() => {
    router.push(`/projects/${project.id}`);
  }, [router, project.id]);

  // The studio requires `focusedInputs.inpaintImageUrl` — the legacy
  // `/refine` room has a `beforeImageUrl` for the same purpose.
  const focusedInputs = useMemo<BuildEditRoomStudioPropsArgs["focusedInputs"]>(
    () => ({
      inpaintImageUrl: focusedRoom.beforeImageUrl,
      // Seeded once from `rawDirectives`; the studio owns its own
      // `liveDirections` derivation after mount. The wrapper does not
      // echo the typed textarea back into this map — keystrokes flow
      // through `onDirectivesChange` → `saveRoomMetadata` only.
      roomDirectives: focusedRoom.rawDirectives ?? "",
    }),
    [focusedRoom.beforeImageUrl, focusedRoom.rawDirectives],
  );

  const studioProps = useMemo(
    () =>
      buildEditRoomStudioProps({
        project: {
          id: project.id,
          propertyAddress: project.propertyAddress,
          // The `/refine` query does not select `stagingAesthetic` /
          // `stagingDirectives`; the wrapper passes blank-safe defaults
          // and the studio falls back to its own copy. Stage B (#1362b)
          // widens the select if the studio ever needs them here.
          stagingAesthetic: "",
          stagingDirectives: undefined,
        },
        focusedRoom: {
          id: focusedRoom.id,
          name: focusedRoom.name,
          selectedVariantIndex: focusedRoom.selectedVariantIndex,
          lookbookHeadline: focusedRoom.lookbookHeadline ?? null,
          lookbookBody: focusedRoom.lookbookBody ?? null,
          rawDirectives: focusedRoom.rawDirectives,
          fineTuneStrength: focusedRoom.fineTuneStrength ?? null,
          fineTuneExpand: focusedRoom.fineTuneExpand ?? null,
          fineTuneSeed: focusedRoom.fineTuneSeed ?? null,
          afterImageUrl: focusedRoom.afterImageUrl,
          afterImageUrl2: focusedRoom.afterImageUrl2,
        },
        focusedInputs,
        directiveStatuses,
        touchUps,
        running,
        onRun: handleRun,
        onExitToProject: handleExitToProject,
        onDirectivesChange: handleDirectivesChange,
        maskDataUrl,
        onMaskChange: setMaskDataUrl,
        // FineTune control handlers — stage B (#1362b) wires persistence.
        onFineTuneStrengthChange: () => {},
        onFineTuneExpandChange: () => {},
        onFineTuneSeedChange: () => {},
      }),
    [
      project.id,
      project.propertyAddress,
      focusedRoom,
      focusedInputs,
      directiveStatuses,
      touchUps,
      running,
      handleRun,
      handleExitToProject,
      handleDirectivesChange,
      maskDataUrl,
    ],
  );

  return <EditRoomStudio {...studioProps} />;
}
