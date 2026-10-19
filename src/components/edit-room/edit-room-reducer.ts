/**
 * Issue #1337 — `<EditRoomStudio>` shell, scope/view state machine.
 *
 * Pure reducer for the Edit Room UX redesign (Magic Patterns
 * `hVPYX2rJ2yawc1XTY2LTRJ` / design `dVy8jC2kXpi1ca8b4A1hcS`).
 *
 * Every action the App.tsx Magic Patterns reference performs is
 * expressed as a reducer transition so the unit tests can pin the
 * shape of state without mounting React. The shell hook
 * (`EditRoomStudio.tsx`) delegates to this reducer via `useReducer` —
 * see `useEditRoomState` below — so the React surface stays thin and
 * the same transitions are reachable from tests, storybook, and future
 * client-only views (a `/design-system/edit-room` preview, etc).
 *
 * Pinned by `tests/edit-room-reducer.test.ts` (issue acceptance
 * criterion: "a vitest test exercises the EditRoomStudio
 * reducer-equivalent ... without mounting React").
 */

import type { EditRoomScope, SlotId } from "@/lib/edit-room-scope";

/** Brush interaction mode for the mask layer. */
export type BrushMode = "paint" | "erase";

/** Shell state. Mirrors the table in issue #1337. */
export interface EditRoomState {
  scope: EditRoomScope;
  viewing: SlotId;
  lookbookSlot: SlotId;
  /**
   * Source of truth for directives now lives in the parent route
   * map as `directives[roomId]`, not in the reducer. The run
   * button's `blockedReason` and the cluster's submit-time
   * `inpaintRoomDirectives` read from there directly.
   * See `EditRoomStudio.tsx` → `EditRoomRunCluster.tsx`'s
   * `props.inpaintRoomDirectives` wiring.
   */
  concept: string | null;
  selected: string[];
  maskVersion: number;
  hasMask: boolean;
  /** Latest mask buffer as a PNG data URL; `null` when the buffer is empty
   *  (CLEAR_MASK or a freshly-cleared resetKey). #1344 — the route also
   *  holds its own `maskDataUrlByRoom` for the submit path; this slot is
   *  the shell-local mirror used by the canvas subtree. */
  maskDataUrl: string | null;
  brushSize: number;
  brushMode: BrushMode;
  compare: boolean;
  /** 0..100 while a run is in flight; null otherwise. */
  running: number | null;
  /** Toast message; cleared by the auto-dismiss effect in the shell. */
  toast: string | null;
}

/** All actions the shell dispatches. Each one is a small, named case. */
export type EditRoomAction =
  | { type: "SET_SCOPE"; scope: EditRoomScope }
  | { type: "SET_VIEWING"; viewing: SlotId }
  | { type: "SET_LOOKBOOK_SLOT"; slot: SlotId }
  | { type: "SET_CONCEPT"; concept: string | null }
  | { type: "TOGGLE_OBJECT"; objectId: string }
  | { type: "CLEAR_SELECTION" }
  | { type: "CLEAR_MASK" }
  | { type: "MARK_MASK_PAINTED" }
  | { type: "SET_MASK_DATA_URL"; value: string | null }
  | { type: "SET_BRUSH_SIZE"; size: number }
  | { type: "SET_BRUSH_MODE"; mode: BrushMode }
  | { type: "SET_COMPARE"; compare: boolean }
  | { type: "TOGGLE_COMPARE" }
  | { type: "RUN_START" }
  | { type: "RUN_PROGRESS"; progress: number }
  | { type: "RUN_DONE" }
  | { type: "SHOW_TOAST"; message: string }
  | { type: "DISMISS_TOAST" };

/** Initial state — mirrors the Magic Patterns App.tsx defaults. */
export const initialEditRoomState: EditRoomState = {
  scope: "whole-room",
  viewing: "original",
  lookbookSlot: "A",
    concept: null,
  selected: [],
  maskVersion: 0,
  hasMask: false,
  maskDataUrl: null,
  brushSize: 48,
  brushMode: "paint",
  compare: false,
  running: null,
  toast: null,
};

/**
 * Build a shell state with optional overrides — used by the shell's
 * lazy `useReducer(reducer, initialArg, init)` form (see
 * `EditRoomStudio.tsx`) so a parent route can seed reducer slots
 * from server-supplied values without mutating the canonical
 * `initialEditRoomState` (which the reducer test pins as a frozen
 * default).
 *
 * Issue #1359 / #1365 — pre-#1365 the seed use case was `directions`,
 * supplied from `Room.rawDirectives` so the textarea restored on
 * remount. #1365 lifted `directions` out of the reducer (the run
 * button's `blockedReason` and the cluster submit-time prompt capture
 * now read from the parent route's `directives[roomId]` map directly,
 * not from a reducer slot), so `createInitialEditRoomState` no longer
 * seeds it. The factory still takes a partial so future seed fields
 * (for example lookbook slot, brush mode, fineTune overrides set
 * before slider mount) compose without a `Partial<…>` cast at the
 * call site.
 */
export function createInitialEditRoomState(
  overrides: Partial<EditRoomState> = {}
): EditRoomState {
  return { ...initialEditRoomState, ...overrides };
}

/**
 * The pure reducer. Returns a new state object on every action — never
 * mutates the input. The two transitions that mirror multiple App.tsx
 * setters in one go (SET_VIEWING clears compare + selected + mask) are
 * documented inline; future readers need to see why the "compare off"
 * side effect is here and not on SET_VIEWING's caller.
 */
export function editRoomReducer(
  state: EditRoomState,
  action: EditRoomAction
): EditRoomState {
  switch (action.type) {
    case "SET_SCOPE":
      // Mirrors App.tsx's onScopeChange: scope flip turns compare off.
      return { ...state, scope: action.scope, compare: false };

    case "SET_VIEWING":
      // Mirrors selectVersion: switching version resets compare + mask
      // + selection so the inspector reflects the new photo. #1344 —
      // also drop the stale maskDataUrl (the new version starts blank).
      return {
        ...state,
        viewing: action.viewing,
        compare: false,
        selected: [],
        maskVersion: state.maskVersion + 1,
        hasMask: false,
        maskDataUrl: null,
      };

    case "SET_LOOKBOOK_SLOT":
      return { ...state, lookbookSlot: action.slot };

    case "SET_CONCEPT":
      // Mirrors onConceptChange: changing the concept drops the prior
      // selection so the new concept starts fresh.
      return { ...state, concept: action.concept, selected: [] };

    case "TOGGLE_OBJECT": {
      const has = state.selected.includes(action.objectId);
      return {
        ...state,
        selected: has
          ? state.selected.filter((id) => id !== action.objectId)
          : [...state.selected, action.objectId],
      };
    }

    case "CLEAR_SELECTION":
      return { ...state, selected: [] };

    case "CLEAR_MASK":
      // Mirrors clearMask: bump maskVersion so the buffer resets; force
      // hasMask=false so the inspector's mask-clear affordance hides.
      // #1344 — `maskDataUrl` mirrors the canvas's current buffer, and
      // CLEAR_MASK means the buffer just became empty: drop the data
      // URL too so a stale snapshot can never reach `submitInpaint`.
      return {
        ...state,
        maskVersion: state.maskVersion + 1,
        hasMask: false,
        maskDataUrl: null,
      };

    case "MARK_MASK_PAINTED":
      // First-stroke dispatch from MaskLayer: flip the flag without
      // bumping maskVersion (paint ADDS to the buffer, doesn't reset).
      return { ...state, hasMask: true };

    case "SET_MASK_DATA_URL":
      // Issue #1344 (real `useInpaintRuns` wire) — MaskLayer emits
      // `toDataURL("image/png")` after every stroke; the shell mirrors
      // it locally so the canvas subtree can read the buffer without
      // an imperative handle. The route already keeps its own copy via
      // `maskDataUrlByRoom`; this slot is the shell-local mirror.
      // Note: STORE the value verbatim. An empty-buffer snapshot can
      // still carry a "near-blank" data URL (e.g. erase-mode left a
      // partial stroke), and the submit path should still see it —
      // CLEAR_MASK is the only transition that should null this out.
      return { ...state, maskDataUrl: action.value };

    case "SET_BRUSH_SIZE":
      return { ...state, brushSize: action.size };

    case "SET_BRUSH_MODE":
      return { ...state, brushMode: action.mode };

    case "SET_COMPARE":
      return { ...state, compare: action.compare };

    case "TOGGLE_COMPARE":
      return { ...state, compare: !state.compare };

    case "RUN_START":
      // Progress starts at 0; the progress effect in the hook drives
      // it forward with the provider's reported percentages.
      return { ...state, running: 0 };

    case "RUN_PROGRESS":
      return { ...state, running: action.progress };

    case "RUN_DONE":
      return { ...state, running: null };

    case "SHOW_TOAST":
      return { ...state, toast: action.message };

    case "DISMISS_TOAST":
      return { ...state, toast: null };

    default: {
      // Exhaustiveness check — adding a new action without a case is a
      // compile error. The `never` cast is the canonical TS idiom.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}