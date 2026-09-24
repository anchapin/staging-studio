/**
 * Collapsible right inspector panel (issue #617).
 *
 * Brush Refinement Studio (Step 3) right inspector: a 380px expanded panel
 * that collapses to a minimal 48px rail, toggled by the panel-header
 * collapse button or Cmd/Ctrl+B. Focus Canvas Mode (issue #638) and Zen
 * Mode (issue #560) hide the inspector completely — the restore pill / Z
 * key own the way back — so the collapse state here only decides between
 * the expanded panel and the rail.
 *
 * Pure resolution logic (keyboard shortcut classification, panel view
 * state machine, collapsed-rail metadata) so it is pinned 1:1 by
 * `tests/inspector-panel.test.ts` — same pattern as `lib/focus-mode.ts`.
 */

/** Expanded inspector width in pixels (spec: 380px, docked right). */
export const INSPECTOR_PANEL_WIDTH_PX = 380;

/** Collapsed rail width in pixels (spec: minimal 48px rail). */
export const INSPECTOR_RAIL_WIDTH_PX = 48;

/** Vertical label shown on the collapsed rail (spec: "Active Inpaint"). */
export const INSPECTOR_RAIL_LABEL = "Active Inpaint";

/**
 * localStorage key for the persisted collapse state, following the
 * issue #588 `useCollapsiblePanel` key naming (`inpaint-editor:<panel>`).
 */
export const INSPECTOR_PANEL_STORAGE_KEY = "inpaint-editor:inspectorPanel";

/** What a keyboard event resolves to for the inspector panel. */
export type InspectorShortcutAction =
  | "toggle-inspector"
  | "toggle-focus-mode"
  | null;

/**
 * The subset of KeyboardEvent the resolver needs, so tests can classify
 * events without a DOM.
 */
export interface InspectorShortcutEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** True when the event target is a text-entry element (input/textarea/contenteditable). */
  isTextEntry?: boolean;
}

/**
 * Classifies a keydown per the issue #617 spec:
 *
 * - `Cmd+B` (Mac) / `Ctrl+B` (Windows) → toggle the inspector panel. Not
 *   guarded on text inputs — the spec's snippet prevents default and
 *   toggles regardless of target (plain inputs have no bold gesture to
 *   preserve).
 * - bare `F` (no Cmd/Ctrl/Alt) → toggle Focus Canvas Mode, but never
 *   while typing (Cmd/Ctrl+F stays the browser's Find).
 *
 * Anything else (including `b` without a modifier, `F` with one) resolves
 * to null and must fall through untouched.
 */
export function resolveInspectorShortcut(
  event: InspectorShortcutEvent
): InspectorShortcutAction {
  const key = event.key.toLowerCase();

  if ((event.metaKey || event.ctrlKey) && key === "b") {
    return "toggle-inspector";
  }

  if (
    key === "f" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.isTextEntry
  ) {
    return "toggle-focus-mode";
  }

  return null;
}

/** What the right inspector column renders. */
export type InspectorPanelView = "expanded" | "rail" | "hidden";

export interface InspectorPanelViewInput {
  /** Issue #617 collapse state (collapse button / Cmd+B). */
  inspectorCollapsed: boolean;
  /** Issue #638 Focus Canvas Mode — canvas-only; the restore pill owns the way back. */
  focusMode: boolean;
  /** Issue #560 Zen Mode — distraction-free; all chrome hidden. */
  zenMode: boolean;
}

/**
 * Zen/Focus modes win over the collapse state: the column is hidden
 * entirely (no rail — Focus Canvas Mode collapses BOTH the header and the
 * inspector, and its floating restore pill is the only affordance back).
 * Otherwise the persisted collapse state decides panel vs rail.
 */
export function resolveInspectorPanelView(
  input: InspectorPanelViewInput
): InspectorPanelView {
  if (input.zenMode || input.focusMode) return "hidden";
  return input.inspectorCollapsed ? "rail" : "expanded";
}

/** The three icon buttons on the collapsed rail (spec order). */
export type InspectorRailActionId = "palette" | "auto-awesome" | "wb-sunny";

export interface InspectorRailAction {
  id: InspectorRailActionId;
  /** Material Symbols icon name from the issue spec (the UI maps it to its lucide equivalent). */
  materialSymbol: string;
  /** Accessible label for the button. */
  label: string;
}

export const INSPECTOR_RAIL_ACTIONS: readonly InspectorRailAction[] = [
  { id: "palette", materialSymbol: "palette", label: "Staging palette" },
  { id: "auto-awesome", materialSymbol: "auto_awesome", label: "AI variations" },
  { id: "wb-sunny", materialSymbol: "wb_sunny", label: "Relight" },
];

/** Editor tab ids the rail can navigate to (mirrors `EditorTabId`). */
export type InspectorRailTargetTab = "entire" | "manual" | "detect";

/** Operation mode ids the rail can navigate to (mirrors `InpaintOperationModeId`). */
export type InspectorRailTargetMode =
  | "inpaint-zone"
  | "restore-original"
  | "relight"
  | "material-swap";

/**
 * Where a rail button lands after re-expanding the inspector. Every rail
 * button's primary job is expanding the panel; the target just aims the
 * user at the matching section (prompt editor / variations / relight).
 */
export interface InspectorRailTarget {
  tab: InspectorRailTargetTab;
  operationMode?: InspectorRailTargetMode;
}

export function resolveInspectorRailTarget(
  actionId: InspectorRailActionId
): InspectorRailTarget {
  switch (actionId) {
    case "palette":
      // palette → targeted prompt editor on the Manual paint tab.
      return { tab: "manual", operationMode: "inpaint-zone" };
    case "auto-awesome":
      // auto_awesome → AI-generated variations (grid sits at the panel bottom).
      return { tab: "manual" };
    case "wb-sunny":
      // wb_sunny → Relight operation.
      return { tab: "manual", operationMode: "relight" };
  }
}
