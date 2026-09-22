"use client";

import { Palette, Sparkles, Sun, type LucideIcon } from "lucide-react";
import {
  INSPECTOR_RAIL_ACTIONS,
  INSPECTOR_RAIL_LABEL,
  type InspectorRailActionId,
} from "@/lib/inspector-panel";

/**
 * Issue #617 maps the spec's Material Symbols names onto the project's
 * lucide-react icon set:
 *   palette     → Palette
 *   auto_awesome → Sparkles
 *   wb_sunny    → Sun
 */
const RAIL_ICONS: Record<InspectorRailActionId, LucideIcon> = {
  palette: Palette,
  "auto-awesome": Sparkles,
  "wb-sunny": Sun,
};

export interface InspectorCollapsedRailProps {
  /**
   * Called with the rail button's action id — the parent expands the
   * inspector and navigates to the matching section (see
   * `resolveInspectorRailTarget`).
   */
  onExpand: (actionId: InspectorRailActionId) => void;
}

/**
 * Collapsed inspector rail (issue #617).
 *
 * The minimal 48px rail that replaces the 380px right inspector panel
 * while it is collapsed: the vertical "Active Inpaint" label plus the
 * three spec'd icon buttons (palette, auto_awesome, wb_sunny). Every
 * button re-expands the inspector and aims the user at the matching
 * section. Fades/slides in over 300ms (`inspectorRailShow` keyframes);
 * below lg it lays out horizontally so the stacked layout stays usable.
 */
export default function InspectorCollapsedRail({
  onExpand,
}: InspectorCollapsedRailProps) {
  return (
    <div
      data-inspector-rail=""
      role="toolbar"
      aria-label={`${INSPECTOR_RAIL_LABEL} inspector rail`}
      className="flex w-full flex-row items-center justify-center gap-3 rounded-md border border-atelier-taupe/30 bg-white px-3 py-2 lg:h-full lg:w-12 lg:flex-col lg:px-1.5 lg:py-3"
      style={{ animation: "inspectorRailShow 300ms ease-out" }}
    >
      {/* Vertical "Active Inpaint" label (horizontal below lg) */}
      <span
        aria-hidden="true"
        className="select-none font-jakarta text-xs font-medium tracking-wide text-atelier-taupe [writing-mode:horizontal-tb] lg:[writing-mode:vertical-rl]"
      >
        {INSPECTOR_RAIL_LABEL}
      </span>

      {INSPECTOR_RAIL_ACTIONS.map((action) => {
        const Icon = RAIL_ICONS[action.id];
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => onExpand(action.id)}
            title={`${action.label} — expand inspector (Cmd+B)`}
            aria-label={`${action.label} — expand inspector`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-atelier-taupe transition-all duration-300 hover:bg-atelier-canvas hover:text-atelier-primary"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
