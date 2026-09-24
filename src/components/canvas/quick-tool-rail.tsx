"use client";

import { cn } from "@/lib/utils";
import {
  Paintbrush,
  PaintBucket,
  MousePointer2,
  Undo2,
  Trash2,
  Layers,
} from "lucide-react";
import type { MaskTool } from "./inpaint-mask-canvas";

interface QuickToolRailProps {
  activeTool: MaskTool;
  onToolChange: (tool: MaskTool) => void;
  onUndo?: () => void;
  onClear?: () => void;
  undoCount?: number;
  className?: string;
}

const TOOLS: Array<{
  id: MaskTool;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}> = [
  { id: "brush", icon: Paintbrush, label: "Brush (B)" },
  { id: "fill", icon: PaintBucket, label: "Fill Region (F)" },
  { id: "select", icon: MousePointer2, label: "Select Regions (S)" },
];

/**
 * Issue #548: 64px vertical quick-tool rail on the left side of the
 * Atelier Canvas workspace. Contains the core canvas tools in icon-only
 * vertical layout with tooltips.
 */
export default function QuickToolRail({
  activeTool,
  onToolChange,
  onUndo,
  onClear,
  undoCount = 0,
  className,
}: QuickToolRailProps) {
  return (
    <div
      className={cn(
        "flex w-16 shrink-0 flex-col items-center gap-1 border-r border-stone-200 bg-white/90 py-3 backdrop-blur-sm",
        className
      )}
      role="toolbar"
      aria-label="Canvas tools"
    >
      {/* Tool group */}
      <div className="flex flex-col gap-1" role="group" aria-label="Mask tools">
        {TOOLS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={activeTool === id}
            aria-label={label}
            title={label}
            onClick={() => onToolChange(id)}
            className={cn(
              "group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
              activeTool === id
                ? "bg-stone-800 text-white"
                : "text-stone-500 hover:bg-stone-100 hover:text-stone-800"
            )}
          >
            {/* Terracotta active indicator — bottom tick */}
            {activeTool === id && (
              <span
                className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-6 rounded-full bg-[#C47847]"
                aria-hidden="true"
              />
            )}
            <Icon className="h-5 w-5" aria-hidden="true" />
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="my-1 h-px w-8 bg-stone-200" aria-hidden="true" />

      {/* Undo */}
      <button
        type="button"
        aria-label={`Undo${undoCount > 0 ? ` (${undoCount})` : ""}`}
        title="Undo (Cmd/Ctrl+Z)"
        onClick={onUndo}
        disabled={undoCount === 0}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Undo2 className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Clear mask */}
      <button
        type="button"
        aria-label="Clear mask"
        title="Clear mask"
        onClick={onClear}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
      >
        <Trash2 className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Scene hierarchy toggle */}
      <button
        type="button"
        aria-label="Scene hierarchy"
        title="Scene hierarchy"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
      >
        <Layers className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
