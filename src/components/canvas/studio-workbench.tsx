"use client";

import type { ReactNode } from "react";
import { WORKBENCH_TOPBAR_SURFACE_CLASSES } from "@/lib/workbench-layout";

export interface StudioWorkbenchProps {
  /**
   * Left sidebar slot — typically `RoomHierarchySidebar` (issue #634),
   * which owns its own 256px (w-64) width and collapse behavior.
   */
  sidebar: ReactNode;
  /**
   * Full-width top directive bar slot — typically
   * `GlobalStagingDirectivesBar` (issue #636) with its 4-card
   * responsive grid. Sits above the canvas.
   */
  topBar: ReactNode;
  /**
   * Center canvas slot — typically `RoomBatchCardMatrix` (issue #622).
   * Flexes to fill the space the sidebar and top bar leave behind.
   */
  children: ReactNode;
  /**
   * Bottom persistent dock slot — typically `WorkbenchDock`. Rendered as
   * the last child of the workspace scroll area so its `sticky bottom-4`
   * positions it at the bottom of THIS container, not the viewport.
   */
  dock?: ReactNode;
}

/**
 * Studio workbench layout grid (issue #620) — the Room Batch Stage
 * (Step 2) shell:
 *
 * ```
 * ┌──────────┬──────────────────────────────┐
 * │          │ top directive bar (full width)│
 * │ sidebar  ├──────────────────────────────┤
 * │ 256px    │                              │
 * │ w-64     │ center canvas (flex-1)       │
 * │ collaps- │                              │
 * │ ible     │ ┌──────────────────────────┐ │
 * │          │ │ bottom dock (sticky)     │ │
 * └──────────┴─┴──────────────────────────┴─┘
 * ```
 *
 * The sidebar column is fixed-width by the sidebar component itself
 * (256px / `w-64`, collapsing to a hidden rail on tablet/mobile per the
 * responsive spec); the center column is `flex-1 min-w-0` so the canvas
 * absorbs the remaining width. The dock lives INSIDE the scroll area —
 * sticky within the workspace, never viewport-fixed.
 */
export default function StudioWorkbench({
  sidebar,
  topBar,
  children,
  dock,
}: StudioWorkbenchProps) {
  return (
    <div
      data-workbench-root=""
      className="flex min-h-full w-full bg-surface-container-low"
    >
      {/* Left column: fixed 256px, collapsible (slot owns its width) */}
      {sidebar}

      {/* Center column: top bar above the canvas; canvas flexes to fill */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          data-workbench-topbar=""
          className={`shrink-0 ${WORKBENCH_TOPBAR_SURFACE_CLASSES}`}
        >
          {topBar}
        </div>

        {/*
         * Workspace scroll area. The dock is its last child, so
         * `sticky bottom-4` keeps it at the bottom of this container —
         * the acceptance criterion "sticky within the workspace (not
         * viewport-fixed)" — while the canvas above scrolls under it.
         */}
        <div
          data-workbench-scroll-area=""
          className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6"
        >
          <div data-workbench-canvas="" className="flex-1">
            {children}
          </div>
          {dock}
        </div>
      </div>
    </div>
  );
}
