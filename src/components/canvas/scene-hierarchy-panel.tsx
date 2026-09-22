"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Image as ImageIcon } from "lucide-react";

interface SceneHierarchyPanelProps {
  /** Issue #252 D5: content rendered above the mask canvas — room imagery, variant strip, directives. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Issue #548: 320px collapsible scene hierarchy panel for the Atelier Canvas
 * workspace. Renders the secondary pane content (room imagery, variant strip,
 * directives) in a left-side panel that can be collapsed to save space.
 */
export default function SceneHierarchyPanel({
  children,
  className,
}: SceneHierarchyPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={cn(
        "flex shrink-0 transition-all duration-300 ease-in-out",
        collapsed ? "w-10" : "w-80",
        className
      )}
    >
      {/* Panel content */}
      <div
        className={cn(
          "flex flex-col gap-4 overflow-y-auto border-r border-stone-200 bg-white/90 px-3 py-3 backdrop-blur-sm transition-all duration-300",
          collapsed ? "w-0 opacity-0" : "w-80 opacity-100"
        )}
        aria-hidden={collapsed}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between">
          <h4 className="font-jakarta text-sm font-medium text-stone-700">
            Scene Hierarchy
          </h4>
          <button
            type="button"
            aria-label={collapsed ? "Expand scene hierarchy panel" : "Collapse scene hierarchy panel"}
            title={collapsed ? "Expand" : "Collapse"}
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-6 w-6 items-center justify-center rounded text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Room imagery slot */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs text-stone-500">
            <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Room Source</span>
          </div>
          {children}
        </div>
      </div>

      {/* Collapse toggle (visible when collapsed) */}
      {collapsed && (
        <button
          type="button"
          aria-label="Expand scene hierarchy panel"
          title="Expand scene hierarchy"
          onClick={() => setCollapsed(false)}
          className="flex w-10 items-center justify-center border-r border-stone-200 bg-white/90 py-3 text-stone-500 transition-colors hover:bg-stone-50 hover:text-stone-800"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
