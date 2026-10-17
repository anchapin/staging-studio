/**
 * Issue #1344 — Build the `<EditRoomStudio>` prop bag from the project
 * detail view's focused-room inputs.
 *
 * The route mount (`project-detail-view.tsx`) already owns the
 * `project`, `focusedRoom`, `focusedInputs`, `directiveStatuses`,
 * `touchUps`, the in-flight run state, and (slice 2) the
 * `maskDataUrlByRoom` state used by the real `/api/inpaint` submit.
 * Wiring those into the studio is a pure shape transformation —
 * this module pins it 1:1 so the route file stays thin (just spreads
 * the resolver's return) and a future prop addition only requires a
 * fixture + test edit here, not a 300-line route-file review.
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
 * - `onDirectionsCommit` ← the route's `editDirectives(roomId, value)`
 *   (issue #1344 slice 2: the studio's debounce effect calls this so
 *   typed directions actually land in the route's
 *   `directives[roomId]` map and feed `useInpaintRuns.promptDirectives`
 *   on submit; without the wire, clicking Run with the studio's typed
 *   value sees an empty parent string and fails the
 *   "No staging directives available." check).
 * - `maskDataUrl` ← `maskDataUrlByRoom[focusedRoom.id]` (issue #1344
 *   slice 2: the painted-area snapshot the submit path forwards to
 *   `/api/inpaint` as `maskUrl`).
 * - `onMaskChange` ← closure that writes
 *   `setMaskDataUrlByRoom(prev => ({...prev, [focusedRoom.id]: value}))`
 *   so the shell stays the source of truth.
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
  /**
   * Issue #1359 — surfaced from `Room.rawDirectives` so the studio
   * can seed `state.directions` from the persisted value on mount.
   * Without this, page reloads present an empty textarea even though
   * the autosave controller wrote the user's keystrokes correctly.
   */
  rawDirectives?: string | null;
  /**
   * Issue #1362a — FineTune persistence. All three columns are
   * nullable on `Room`, so a legacy row ships `null` for each. The
   * resolver forwards null → `undefined` so the studio's
   * `useState(seed ?? 50)` fallbacks land at the UI's natural
   * defaults (strength=50 → 0.5 at the wire; expand=12; seed="").
   * Stage A only persists; Stage B (#1362b) wires the persisted values
   * into the DashScope request.
   */
  fineTuneStrength?: number | null;
  fineTuneExpand?: number | null;
  fineTuneSeed?: string | null;
}

/** The minimal focused-inputs slice the resolver reads. */
export interface FocusedRoomInputs {
  inpaintImageUrl: string | null;
  /**
   * Issue #1365 — live route-mapped value the studio's textarea
   * renders. Source is the parent route's `directives[roomId]` map
   * (or `Room.rawDirectives` fallback). #1365 added this so the
   * build helper can forward it to `<EditRoomStudio>`'s `directions`
   * prop without a second arg (and so test fixtures explicitly
   * thread the route-mapped value rather than rely on implicit
   * shape compat). New fixtures must supply this field; legacy
   * fixtures that omit it fall back to `initialDirections` inside
   * the shell's `liveDirections` derivation.
   *
   * Shape choice — `string`, not `string | null | undefined`: the
   * route's fallback chain (`directives[roomId] ?? room.rawDirectives
   * ?? ""`) collapses to `""` at the call site before the resolver
   * ever sees it. Widening the type to accept null would just shift
   * the `??` from the route to the resolver without changing
   * behavior — kept narrow here so a future caller that forgets the
   * fallback surfaces as a typecheck rather than a silent `null` in
   * the textarea. (#1365 next-session handoff, Priority 1.)
   */
  roomDirectives: string;
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
  /**
   * Issue #1365 — per-keystroke callback the textarea's `onChange`
   * calls. The parent's `editDirectives(roomId, value)` is wrapped
   * here verbatim — every keystroke updates `directives[roomId]`
   * immediately (the parent's `AutosaveController` schedules the
   * server-side persistence with trailing-edge debounce, not this
   * callback). Pre-#1365 the shell held a `state.directions` slot
   * + 900ms debounce that called `onDirectionsCommit`; that path
   * was removed because it raced the submit-time prompt capture
   * (the cluster missed the user's last keystrokes on first
   * render) and was the source of the #1365 quirk.
   */
  onDirectivesChange: (value: string) => void;
  /**
   * Issue #1344 slice 2 — the painted-area snapshot the submit path
   * forwards to `/api/inpaint` as `maskUrl`. Source of truth is the
   * route's `maskDataUrlByRoom` map (managed by `onMaskChange`); the
   * studio holds a mirror.
   */
  maskDataUrl: string | null;
  /**
   * Issue #1365 — the live route-mapped value the studio's textarea
   * renders. Source is `FocusedRoomInputs.roomDirectives` (which the
   * parent route mutates on every `editDirectives` call). When the
   * arg is omitted the build helper defaults to `initialDirections`
   * for tests written before #1365 (those fixtures are kept working
   * by the fallback inside `EditRoomStudio.tsx`'s `liveDirections`
   * derivation; new fixtures should pass it explicitly).
   */
  directions?: string;
  /**
   * Issue #1344 slice 2 — closure that updates
   * `maskDataUrlByRoom[focusedRoom.id]` when the MaskLayer emits a
   * new buffer snapshot. The shell calls it on every stroke and
   * CLEAR_MASK.
   */
  onMaskChange: (value: string | null) => void;
  /**
   * Issue #1362a — FineTune autosave callbacks. The route's
   * `editFineTune(roomId, patch)` fans out to the per-room
   * AutosaveController; the shell calls the relevant one on each
   * control change. Three callbacks so the shell can update local
   * state in the same handler that fires the autosave (same shape as
   * the directives `onDirectionsCommit`).
   */
  onFineTuneStrengthChange: (value: number) => void;
  onFineTuneExpandChange: (value: number) => void;
  onFineTuneSeedChange: (value: string) => void;
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
 * Narrow `AutosaveStatus` (`"idle" | "dirty" | "saving" | "saved" |
 * "error"`) to the new shell's `SaveStatus` (`"idle" | "saving" |
 * "saved" | "error"`). The intermediate `"dirty"` state has no
 * shell-level affordance — the legacy mount's pre-existing
 * `editor-inspector-column.tsx` lumps `dirty` into the "Saved"
 * copy too — so we treat it the same here. Unknown values (and
 * `undefined`) fall through to `"idle"`, the conservative default.
 */
function narrowSaveStatus(value: unknown): EditRoomStudioProps["saveStatus"] {
  if (value === "saving" || value === "saved" || value === "error") {
    return value;
  }
  return "idle";
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
    onDirectivesChange,
    maskDataUrl,
    onMaskChange,
    onFineTuneStrengthChange,
    onFineTuneExpandChange,
    onFineTuneSeedChange,
  } = args;
  return {
    // Narrow `AutosaveStatus` ("idle" | "dirty" | "saving" | "saved" |
    // "error") to the new shell's `SaveStatus` ("idle" | "saving" |
    // "saved" | "error"). The route passes the broader
    // `AutosaveStatus` map and the shell's `TopBar` `SAVE_LABEL` has
    // no `"dirty"` entry, which would throw on the `.spin` read. The
    // coarse narrowing here matches the legacy `<InpaintEditor>`'s
    // pre-existing semantics: the user-facing pill shows "Saving…" /
    // "Saved" / "Save failed" / "Saved" — the intermediate "dirty"
    // state is invisible at the shell level.
    saveStatus: narrowSaveStatus(directiveStatuses[focusedRoom.id]),
    onDirectivesChange,
    projectId: project.id,
    roomId: focusedRoom.id,
    roomName: focusedRoom.name,
    initialLookbookSlot: resolveInitialLookbookSlot(
      focusedRoom.selectedVariantIndex
    ),
    touchUps,
    initialCopyHeadline: focusedRoom.lookbookHeadline ?? "",
    initialCopyBody: focusedRoom.lookbookBody ?? "",
    // Issue #1359 — seed the shell's textarea from
    // `Room.rawDirectives` so a page reload restores the user's
    // typed directions (was previously dropped on remount; the
    // copy tab's "Rewrite from directions" CTA dead-ended as a
    // result). #1365 — keep this as the post-mount fallback; the
    // live `directions` prop below carries the route-mapped value
    // that the textarea actually re-renders on every keystroke.
    initialDirections: focusedRoom.rawDirectives ?? "",
    // Issue #1365 — the live route-mapped value the textarea
    // renders. `FocusedRoomInputs.roomDirectives` is the same map
    // the parent updates on every `editDirectives` call. When the
    // arg is missing (legacy test fixture) the studio's
    // `liveDirections` derivation falls back to `initialDirections`
    // + empty-string; explicit `roomDirectives` overrides.
    directions: focusedInputs.roomDirectives,
    // Issue #1362a — seed the shell's FineTune useStates from the
    // persisted columns. Each column is nullable (legacy rows have
    // nulls); the studio's `useState(initialFineTune.strength ?? 50)`
    // shape handles missing → UI defaults.
    initialFineTune: {
      strength: focusedRoom.fineTuneStrength ?? null,
      expand: focusedRoom.fineTuneExpand ?? null,
      seed: focusedRoom.fineTuneSeed ?? null,
    },
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
    maskDataUrl,
    onMaskChange,
    // Issue #1362a — pass-through to the shell's FineTune useStates.
    // The shell fans these out to the matching useState setters and
    // fires the parent route's `editFineTune(roomId, patch)` via the
    // same handler.
    onFineTuneStrengthChange,
    onFineTuneExpandChange,
    onFineTuneSeedChange,
  };
}