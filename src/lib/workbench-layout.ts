/**
 * Issue #620: Studio workbench layout grid (Room Batch Stage — Step 2).
 *
 * Pure layout logic for the workbench shell:
 *
 * ```
 * Left sidebar:  256px (w-64)  — fixed, collapsible
 * Center canvas: flex-1        — fills remaining space
 * Top bar:       full width    — above the canvas
 * Bottom dock:   full width    — sticky at bottom of the workspace
 * ```
 *
 * Class-name constants live here so tests can pin the exact utilities the
 * components render (same pattern as tests/comparison-slider.test.ts).
 * Pinned 1:1 by tests/workbench-layout.test.ts.
 */

/** Expanded sidebar width in px — the spec pins it at 256px (Tailwind `w-64`). */
export const WORKBENCH_SIDEBAR_WIDTH_PX = 256;

/** Sidebar width classes: fixed 256px expanded; zero-width rail collapsed. */
export const WORKBENCH_SIDEBAR_WIDTH_CLASSES = {
  expanded: "w-64",
  collapsed: "w-0 overflow-hidden",
} as const;

/** Resolve the sidebar's width class from its collapsed flag. */
export function workbenchSidebarWidthClass(isCollapsed: boolean): string {
  return isCollapsed
    ? WORKBENCH_SIDEBAR_WIDTH_CLASSES.collapsed
    : WORKBENCH_SIDEBAR_WIDTH_CLASSES.expanded;
}

/**
 * Warm glassmorphic sidebar surface: `surface-container-low` at 95% over a
 * backdrop blur, separated from the canvas by a hairline `outline-variant`
 * right border (issue #620 sidebar spec).
 */
export const WORKBENCH_SIDEBAR_SURFACE_CLASSES =
  "border-r border-outline-variant/30 bg-surface-container-low/95 backdrop-blur-md";

/** Top directive bar surface, full width above the canvas. */
export const WORKBENCH_TOPBAR_SURFACE_CLASSES =
  "border-b border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-md";

/**
 * Top directive bar card grid: single column on mobile, 2 up from tablet,
 * the spec's 4-card row from `xl` up.
 */
export const WORKBENCH_DIRECTIVE_GRID_CLASSES =
  "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4";

/**
 * Bottom persistent dock position. Deliberately `sticky bottom-4` — sticky
 * within the workspace scroll container, NEVER `fixed`, so the dock rides
 * the workspace instead of pinning to the viewport (issue #620 acceptance
 * criterion: "sticky within the workspace (not viewport-fixed)").
 */
export const WORKBENCH_DOCK_POSITION_CLASSES = "sticky bottom-4";

/** Warm glassmorphic dock surface: 90% `surface-container-lowest` + blur. */
export const WORKBENCH_DOCK_SURFACE_CLASSES =
  "rounded-xl border border-outline-variant/30 bg-surface-container-lowest/90 backdrop-blur-md shadow-warm-lg";

/**
 * A sidebar room-list item's visual state (issue #620 room item table):
 *
 * | State   | Left border          | Background                  | Badge       |
 * |---------|----------------------|-----------------------------|-------------|
 * | active  | border-secondary     | surface-container-lowest    | dot only    |
 * | pending | none                 | surface-container (hover)   | task label  |
 * | ready   | none                 | surface-container (hover)   | "n Ready"   |
 * | empty   | none                 | opacity-70                  | "Empty"     |
 */
export type WorkbenchRoomItemState = "active" | "pending" | "ready" | "empty";

/** Inputs needed to resolve a room list item's state. */
export interface WorkbenchRoomStatusInput {
  /** The room is the currently selected scene. */
  isActive: boolean;
  /** The room has at least one uploaded photo. */
  hasPhotos: boolean;
  /** Count of completed staged variants for the room. */
  readyVariantCount: number;
}

/**
 * Resolve the item state. `active` wins over everything (the design's
 * Living Room row stays active regardless of content); a photo-less room
 * is `empty`; a room with at least one staged variant is `ready`; anything
 * else with photos is `pending`.
 */
export function resolveWorkbenchRoomItemState(
  input: WorkbenchRoomStatusInput
): WorkbenchRoomItemState {
  if (input.isActive) return "active";
  if (!input.hasPhotos) return "empty";
  if (input.readyVariantCount > 0) return "ready";
  return "pending";
}

/** The right-edge status indicator of a room list item. */
export type WorkbenchRoomIndicator =
  | { kind: "dot" }
  | { kind: "badge"; text: string };

/**
 * Resolve the indicator: the active room shows only its terracotta status
 * dot; `ready` shows its ready count ("2 Ready"); `pending` shows its task
 * label (e.g. "Declutter"), falling back to "Pending"; `empty` shows
 * "Empty".
 */
export function workbenchRoomIndicator(
  state: WorkbenchRoomItemState,
  readyVariantCount: number,
  pendingTaskLabel?: string | null
): WorkbenchRoomIndicator {
  switch (state) {
    case "active":
      return { kind: "dot" };
    case "ready":
      return { kind: "badge", text: `${readyVariantCount} Ready` };
    case "empty":
      return { kind: "badge", text: "Empty" };
    case "pending": {
      const label = pendingTaskLabel?.trim();
      return { kind: "badge", text: label && label.length > 0 ? label : "Pending" };
    }
  }
}

/** Tailwind classes for one room list item, per state. */
export interface WorkbenchRoomItemClasses {
  /** Classes for the item's row (border, background, text color). */
  container: string;
  /** Classes for the item's leading room icon. */
  icon: string;
}

/**
 * Per-state row/icon classes. The active row carries the terracotta
 * left border on the `surface-container-lowest` fill with a
 * `text-secondary` icon; pending/ready rows are transparent until hover
 * (`hover:bg-surface-container`) with an `outline-variant` icon; the empty
 * row additionally dims via `opacity-70`.
 */
export function workbenchRoomItemClasses(
  state: WorkbenchRoomItemState
): WorkbenchRoomItemClasses {
  switch (state) {
    case "active":
      return {
        container:
          "border-l-2 border-secondary bg-surface-container-lowest font-medium text-foreground",
        icon: "text-secondary",
      };
    case "empty":
      return {
        container:
          "border-l-2 border-transparent text-muted-foreground opacity-70 hover:bg-surface-container hover:text-foreground",
        icon: "text-outline-variant",
      };
    case "pending":
    case "ready":
      return {
        container:
          "border-l-2 border-transparent text-muted-foreground hover:bg-surface-container hover:text-foreground",
        icon: "text-outline-variant",
      };
  }
}

/** Bottom-dock session status (issue #620: session status + status text). */
export type WorkbenchSessionStatus = "draft" | "saving" | "ready";

/** Label shown in the dock's session-status pill. */
export function workbenchSessionStatusLabel(
  status: WorkbenchSessionStatus
): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "saving":
      return "Saving…";
    case "ready":
      return "Session Ready";
  }
}

/** Tailwind class for the session pill's status dot. */
export function workbenchSessionDotClasses(
  status: WorkbenchSessionStatus
): string {
  switch (status) {
    case "draft":
      return "bg-muted-foreground/40";
    case "saving":
      return "bg-secondary-fixed animate-pulse";
    case "ready":
      return "bg-secondary-fixed";
  }
}

/**
 * Human summary of batch progress for the dock's status text, e.g.
 * "3 of 5 rooms staged". An empty project gets an explicit call to action.
 */
export function workbenchDockStatusText(
  readyRooms: number,
  totalRooms: number
): string {
  if (totalRooms <= 0) {
    return "No rooms yet — add a room scene to begin staging";
  }
  const noun = totalRooms === 1 ? "room" : "rooms";
  return `${readyRooms} of ${totalRooms} ${noun} staged`;
}
