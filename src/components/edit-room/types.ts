/**
 * Issue #1337 — `<EditRoomStudio>` shell.
 *
 * Public types for the Edit Room UX redesign. Re-exports the lib-level
 * scope/slot aliases so consumers (top-bar, canvas-stage, inspector)
 * can import from one place; everything else here is the local
 * component-prop shape the Magic Patterns code uses.
 */

import type { SlotId } from "@/lib/edit-room-scope";
import type { EditRoomState } from "@/components/edit-room/edit-room-reducer";

export type { EditRoomScope, SlotId, EditRoomVersion } from "@/lib/edit-room-scope";

/** Save status mirrored from the parent route's AutosaveController. */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Shape of one variant slot the version strip renders. Mirrors the
 * Magic Patterns `Version` type but typed against the Prisma
 * `selectedVariantIndex` (0/1 → "A"/"B"). The reducer test in
 * `tests/edit-room-reducer.test.ts` does not depend on this type;
 * slice #1340 will pin the version-strip against it.
 */
export interface Version {
  id: SlotId;
  label: string;
  url: string | null;
  touchUps: number;
}

/**
 * The shell's prop contract — every prop the parent route (or a
 * future storybook preview) must supply. The shell itself owns the
 * rest of the state via `useReducer` (see
 * `edit-room-reducer.ts`); `saveStatus` is the one exception (the
 * AutosaveController lives at the route level, not inside the shell).
 *
 * Issue #1344 (`route mount` slice) — the shell becomes a controlled
 * component for run state. The parent route owns the submit +
 * status-polling machinery via its existing `useInpaintRuns`
 * integration; the shell renders the parent's `running` value
 * verbatim on the canvas overlay, the Run button, and the version
 * strip. `onRun` is the shell's pass-through to the parent.
 */
export interface EditRoomStudioProps {
  /** Auto-save status mirrored from the parent route's AutosaveController. */
  saveStatus: SaveStatus;
  /**
   * Issue #1340 — Required by the version strip's "Use in lookbook" CTA.
   * Passed through to the `setLookbookVariant` server action so the
   * column update can attribute the write. Stubbed to `"room-1"` in
   * the shell's preview/demo surface; real values arrive in #1344
   * (parent route wiring).
   */
  projectId: string;
  /** Issue #1340 — Same context for the server action's room filter. */
  roomId: string;
  /**
   * Issue #1340 — Initial variant pinned to the lookbook, surfaced from
   * `Room.selectedVariantIndex` by the parent route. Drives the badge
   * position on the strip's first paint and the CTA's static-line state.
   */
  initialLookbookSlot: SlotId;
  /**
   * Issue #1340 — Per-slot touch-up counts surfaced from
   * `getVariantTouchUpCounts` by the parent route. Empty slots get a
   * touch-ups count of 0. The shell does not need to refetch — the
   * parent route's autosave controller handles the refresh cadence.
   */
  touchUps: { original: number; A: number; B: number };
  /**
   * Issue #1343 — Initial persisted Headline value from
   * `Room.lookbookHeadline`. Pre-populates the CopyPanel's Headline
   * input on first render; subsequent edits are shell-owned state.
   * Empty string (not `null` — the CopyPanel's `<input>` uses a
   * controlled string value) when the column is null in the DB.
   */
  initialCopyHeadline: string;
  /**
   * Issue #1343 — Initial persisted Description value from
   * `Room.lookbookBody`. Pre-populates the CopyPanel's textarea on
   * first render; subsequent edits are shell-owned state. The
   * lookbook render — via `resolveListingCopy` — falls back to the
   * legacy `recommendation` column when this is null.
   */
  initialCopyBody: string;
  /**
   * Issue #1359 — Initial persisted staging directives from
   * `Room.rawDirectives`. Pre-populates the Directions textarea on
   * mount so a page reload doesn't present an empty form even
   * though the autosave controller persists the user's keystrokes
   * correctly. Empty string (not `null` — the textarea uses a
   * controlled string value) when `Room.rawDirectives` is null.
   *
   * The shell seeds the reducer with this value via React's lazy
   * `useReducer(reducer, initialArg, init)` form (the initializer
   * runs once per mount), then owns the field locally. A separate
   * `useEffect` watching `initialDirections` (same pattern as the
   * `initialLookbookSlot` reset above) re-seeds the reducer when
   * the prop changes — for the rare case where the user switches
   * rooms without remounting the studio.
   *
   * Without this seed, the reducer's `directions: ""` initial value
   * wins, and the listing copy tab's "Rewrite from directions" CTA
   * (gated on `directions.trim().length > 0`) dead-ends after a
   * reload even though the directives are saved in the DB.
   *
   * Marked optional for test-fixture ergonomics (existing fixtures
   * written before #1359 mount `<EditRoomStudio>` without it). The
   * shell coerces `undefined → ""` in the lazy initializer so the
   * textarea starts empty when no seed is supplied, matching the
   * pre-#1359 default shape.
   */
  initialDirections?: string;
  /**
   * Issue #1365 — Live route-mapped directives value. The parent
   * route's `directives[roomId]` map (see `project-detail-view.tsx`
   * `editDirectives` callback) is the source of truth: every
   * keystroke in the Directions textarea reaches here via the
   * `onDirectivesChange` callback, and the shell re-renders the
   * textarea with this prop. The shell's reducer no longer stores
   * `directions` (the previous reducer-buffered path made the run
   * button's `blockedReason` race `SET_DIRECTIONS` and missed the
   * cluster's submit-time prompt capture — this prop is what
   * unblocks that, by removing the reducer-buffered step entirely).
   *
   * Falls back to `initialDirections` for test fixtures written
   * before #1365 (the studio's preview/demo surface hasn't been
   * updated to thread the route map yet — that lands in #1365
   * follow-up once the test fixture convention is decided). When
   * neither is supplied, the textarea starts empty (the
   * uncontrolled-empty default the reducer used to provide).
   */
  directions?: string;
  /**
   * Issue #1365 — Callback wired from the parent route's
   * `editDirectives(roomId, value)`. Fires on every textarea
   * `onChange`. The parent already debounces persistence via its
   * `AutosaveController` (the shell's pre-#1365 900ms
   * `DIRECTIONS_DEBOUNCE_MS` debounce has been removed — the
   * controlled-value pattern means there is no race to debounce;
   * the parent's controller schedules the server write).
   *
   * The shell still needs to mirror the parent's route map locally
   * so the prop-driven re-render happens; the parent already does
   * this in its `setDirectives({[roomId]: value})` call site, and
   * the new render reads from `props.directions` directly.
   */
  onDirectivesChange?: (value: string) => void;
  /**
   * Issue #1362a — Initial persisted FineTune values from
   * `Room.fineTuneStrength` / `Room.fineTuneExpand` / `Room.fineTuneSeed`.
   * Pre-populates the FineTune panel's three surviving controls
   * (strength, expand, seed) on first render; subsequent edits are
   * shell-owned `useState` values fed through the route's
   * `editFineTune` autosave controller. Each field is nullable so a
   * legacy row (or any column not yet written) falls back to the
   * UI's natural defaults at the `useState(seed ?? 50)` site.
   *
   * Marked optional for test-fixture ergonomics — pre-#1362a fixtures
   * mount `<EditRoomStudio>` without it. The shell coerces
   * `undefined → { strength:null, expand:null, seed:null }` at the
   * `useState(initialFineTune?.strength ?? 50)` site so the controls
   * start at their default values, matching the pre-#1362a shape.
   *
   * Stage A only persists. The persisted values do NOT reach DashScope
   * yet — Stage B (#1362b) wires them into the alibaba adapter's
   * `parameters.strength` / `parameters.seed` and adds the mask-feather
   * utility for the `expand` slider.
   */
  initialFineTune?: {
    strength: number | null;
    expand: number | null;
    seed: string | null;
  };
  /**
   * Issue #1362a — FineTune autosave callbacks. The shell fires the
   * relevant one on every control change; the route's
   * `editFineTune(roomId, patch)` translates that into a
   * `AutosaveController.edit()` call that debounces to `saveRoomMetadata`.
   * Mirrors `onDirectivesChange` (#1365 — per-keystroke, no shell
   * debounce; the parent's `editDirectives` already wraps persistence
   * in the AutosaveController, so the shell is now a thin
   * pass-through rather than debouncing its own callback): the
   * parent route owns the per-room controller map, the shell is a
   * thin pass-through.
   *
   * Each callback receives only the field it owns so the parent's
   * `editFineTune` can decide whether to send a partial patch or a
   * full snapshot — same flexibility `rawDirectives` has today.
   */
  onFineTuneStrengthChange: (value: number) => void;
  onFineTuneExpandChange: (value: number) => void;
  onFineTuneSeedChange: (value: string) => void;
  /**
   * Issue #1344 — Property address shown in the TopBar's breadcrumb.
   * Surfaced from `Project.propertyAddress` by the parent route.
   * Drives the breadcrumb `<span>` between "All rooms" and the
   * room-name listbox trigger.
   */
  address: string;
  /**
   * Issue #1344 — Display name shown in the TopBar's room-name
   * listbox trigger (the current room) and the listbox option.
   * Surfaced from `Room.name` by the parent route.
   */
  roomName: string;
  /**
   * Issue #1344 — Resolved inpaint-source URL for the canvas.
   * Surfaced from `resolveInpaintSourceUrl` by the parent route so
   * the canvas image is always the chosen source, never a stub. The
   * shell's earlier `PLACEHOLDER_URLS` lookup is removed entirely
   * (`/edit-room/*.jpg` was never a real route).
   */
  imageUrl: string;
  /**
   * Issue #1344 — Per-variant-lookbook URL map for the version strip's
   * thumbnail strip. Surfaced from `Room.afterImageUrl` (slot 0 → A)
   * and `Room.afterImageUrl2` (slot 1 → B) by the parent route.
   * `null` when the slot has no staged variant yet.
   */
  lookbookVariantUrls: { A: string | null; B: string | null };
  /**
   * Issue #1344 — Project-wide aesthetic forwarded to the Inspector's
   * `projectAesthetic` slot (which renders the "Also applied from the
   * project: <aesthetic>" disclosure). Surfaced from
   * `Project.stagingAesthetic` by the parent route.
   */
  aesthetic: string;
  /**
   * Issue #1344 — Project-wide staging directives ("keep original
   * molding visible", etc.) forwarded to the Inspector's
   * `projectGlobalDirectives` slot (which renders the collapsible's
   * "Rules for every room" disclosure). Surfaced from
   * `Project.stagingDirectives` by the parent route.
   */
  globalDirectives: string;
  /**
   * Issue #1344 — Controlled run state. `null` when no run is in
   * flight; `0..100` while a run is in flight (the parent route's
   * `useInpaintRuns` reports the provider's progress percent).
   * Drives the canvas overlay, the Run button's label + spinner,
   * and the version strip's `running` flag.
   */
  running: number | null;
  /**
   * Issue #1344 — Pass-through to the parent route's submit path
   * (`/api/inpaint` + `useInpaintRuns`). The shell no longer
   * dispatches `RUN_START` itself — that decision is made by the
   * parent so the route can attribute the run to a real provider
   * request id, not a stub.
   */
  onRun: () => void;
  /**
   * Issue #1344 — TopBar's "All rooms" button callback. Wired to the
   * project view's `leaveEditor` (issue #1188) so the same
   * `confirmLeaveEditorInBrowser` guard still protects an in-flight
   * run from being silently dropped.
   */
  onExitToProject: () => void;
  /**
   * Issue #1344 (real `useInpaintRuns` wire) — Mask buffer as a PNG
   * data URL. Mirrored into the shell on every paint/erase so the
   * canvas subtree can read the buffer without an imperative handle;
   * also rendered back up to the parent on `onMaskChange` so the
   * route's `submitInpaint(maskUrl)` call has a fresh payload at
   * submit time. `null` when the buffer is empty (initial state, or
   * after CLEAR_MASK).
   */
  maskDataUrl: string | null;
  /**
   * Issue #1344 (real `useInpaintRuns` wire) — Shell forwards the
   * MaskLayer's `onChange` (paint, erase, clearRect) so the parent
   * route can capture the latest buffer in its `maskDataUrlByRoom`
   * state. The route reads this on Run click and passes it as
   * `maskUrl` to `submitInpaint`.
   */
  onMaskChange: (dataUrl: string | null) => void;
}

/**
 * Internal selector hook return — exported for the child slices
 * (`#1338..#1342`) to avoid prop drilling. Children re-export via
 * `useEditRoomStudioState` once they add their own state.
 */
export type { EditRoomState };