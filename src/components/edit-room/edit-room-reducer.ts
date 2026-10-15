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
  directions: string;
  concept: string | null;
  selected: string[];
  maskVersion: number;
  hasMask: boolean;
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
  | { type: "SET_DIRECTIONS"; value: string }
  | { type: "SET_CONCEPT"; concept: string | null }
  | { type: "TOGGLE_OBJECT"; objectId: string }
  | { type: "CLEAR_SELECTION" }
  | { type: "CLEAR_MASK" }
  | { type: "MARK_MASK_PAINTED" }
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
  directions: "",
  concept: null,
  selected: [],
  maskVersion: 0,
  hasMask: false,
  brushSize: 48,
  brushMode: "paint",
  compare: false,
  running: null,
  toast: null,
};

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
      // + selection so the inspector reflects the new photo.
      return {
        ...state,
        viewing: action.viewing,
        compare: false,
        selected: [],
        maskVersion: state.maskVersion + 1,
        hasMask: false,
      };

    case "SET_LOOKBOOK_SLOT":
      return { ...state, lookbookSlot: action.slot };

    case "SET_DIRECTIONS":
      // Debouncing is the hook's job, not the reducer's; the reducer
      // just stores the latest value verbatim (whitespace preserved —
      // the form-field contract is "what you typed is what gets saved").
      return { ...state, directions: action.value };

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
      return { ...state, maskVersion: state.maskVersion + 1, hasMask: false };

    case "MARK_MASK_PAINTED":
      // First-stroke dispatch from MaskLayer: flip the flag without
      // bumping maskVersion (paint ADDS to the buffer, doesn't reset).
      return { ...state, hasMask: true };

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