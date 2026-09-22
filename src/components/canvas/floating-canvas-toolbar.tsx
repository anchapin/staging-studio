"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Paintbrush,
  PaintBucket,
  MousePointer2,
  Undo2,
  Trash2,
  Minus,
  Plus,
  Loader2,
  Moon,
  Sun,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type { MaskTool } from "./inpaint-mask-canvas";

interface FloatingCanvasToolbarProps {
  /** Currently active mask tool. */
  activeTool: MaskTool;
  /** Called when the user selects a different tool. */
  onToolChange: (tool: MaskTool) => void;
  /** Called when undo is requested. */
  onUndo?: () => void;
  /** Called when clear mask is requested. */
  onClear?: () => void;
  /** Number of undo steps available. */
  undoCount?: number;
  /** Currently selected brush size. */
  brushSize: number;
  /** Called when brush size changes. */
  onBrushSizeChange: (size: number) => void;
  /** Whether Zen Mode is active. */
  zenMode?: boolean;
  /** Whether dark background is active (Zen Mode). */
  zenDarkBackground?: boolean;
  /** Toggle Zen Mode. */
  onZenModeToggle?: () => void;
  /** Toggle dark background. */
  onZenDarkBackgroundToggle?: () => void;
  /** Whether segmenting (loading state for select tool). */
  segmenting?: boolean;
  /** Whether segment selection is disabled. */
  segmentDisabled?: boolean;
  className?: string;
}

/**
 * Issue #548: Floating canvas toolbar anchored at the viewport base.
 * Dual-mode glassmorphic dock with segmented icon groups and terracotta
 * bottom tick active indicator.
 *
 * - Normal mode: shows tool group + brush size + undo/clear
 * - Zen mode: same controls, with dark/light background toggle
 *
 * The terracotta (#C47847) bottom tick marks the active tool.
 */
export default function FloatingCanvasToolbar({
  activeTool,
  onToolChange,
  onUndo,
  onClear,
  undoCount = 0,
  brushSize,
  onBrushSizeChange,
  zenMode = false,
  zenDarkBackground = false,
  onZenModeToggle,
  onZenDarkBackgroundToggle,
  segmenting = false,
  segmentDisabled = false,
  className,
}: FloatingCanvasToolbarProps) {
  const [showLegend, setShowLegend] = useState(false);

  const TOOL_GROUPS = [
    { id: "brush", icon: Paintbrush, label: "Brush", tool: "brush" as MaskTool },
    { id: "fill", icon: PaintBucket, label: "Fill Region", tool: "fill" as MaskTool },
    {
      id: "select",
      icon: MousePointer2,
      label: segmenting ? "Selecting..." : "Select Regions",
      tool: "select" as MaskTool,
    },
  ];

  return (
    <>
      <div
        className={cn(
          // Glassmorphic container — translucent warm backdrop
          "fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-3 rounded-2xl border border-stone-200/60 bg-white/90 px-4 py-3 backdrop-blur-xl shadow-2xl shadow-black/10",
          className
        )}
        style={{ minWidth: "max-content" }}
        role="toolbar"
        aria-label="Canvas toolbar"
      >
        {/* Tool groups in segmented layout */}
        <div className="flex items-center gap-2">
          {/* Primary tools — brush / fill / select */}
          <div
            role="group"
            aria-label="Mask tools"
            className="flex items-center gap-1 rounded-xl border border-stone-200/80 bg-stone-50/60 p-1"
          >
            {TOOL_GROUPS.map(({ id, icon: Icon, label, tool }) => (
              <button
                key={id}
                type="button"
                aria-pressed={activeTool === tool}
                aria-label={label}
                aria-busy={tool === "select" && segmenting}
                disabled={tool === "select" && segmentDisabled}
                onClick={() => onToolChange(tool)}
                className={cn(
                  "group relative flex h-10 w-10 items-center justify-center rounded-lg transition-all",
                  activeTool === tool
                    ? "bg-stone-800 text-white shadow-sm"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-800",
                  tool === "select" && segmentDisabled && "opacity-50 cursor-not-allowed"
                )}
              >
                {/* Terracotta bottom tick on active tool */}
                {activeTool === tool && (
                  <span
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-6 rounded-full bg-[#C47847]"
                    aria-hidden="true"
                  />
                )}
                {tool === "select" && segmenting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Icon className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>

          {/* Brush size group */}
          <div
            role="group"
            aria-label="Brush size"
            className="flex items-center gap-1.5 rounded-xl border border-stone-200/80 bg-stone-50/60 px-3 py-1.5"
          >
            <button
              type="button"
              aria-label="Decrease brush size"
              onClick={() => onBrushSizeChange(Math.max(1, brushSize - 5))}
              className="flex h-7 w-7 items-center justify-center rounded text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
            >
              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <span className="w-8 text-center font-jakarta text-sm tabular-nums font-medium text-stone-700">
              {brushSize}
            </span>

            <button
              type="button"
              aria-label="Increase brush size"
              onClick={() => onBrushSizeChange(Math.min(100, brushSize + 5))}
              className="flex h-7 w-7 items-center justify-center rounded text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Utility tools — undo / clear / legend */}
          <div
            role="group"
            aria-label="Canvas utilities"
            className="flex items-center gap-1 rounded-xl border border-stone-200/80 bg-stone-50/60 p-1"
          >
            <button
              type="button"
              aria-label={`Undo${undoCount > 0 ? ` (${undoCount})` : ""}`}
              title="Undo (Cmd/Ctrl+Z)"
              disabled={undoCount === 0}
              onClick={onUndo}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              aria-label="Clear mask"
              title="Clear mask"
              onClick={onClear}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              aria-label={showLegend ? "Hide shortcuts" : "Show shortcuts"}
              title="Keyboard shortcuts"
              onClick={() => setShowLegend((s) => !s)}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800",
                showLegend && "bg-stone-100 text-stone-800"
              )}
            >
              ?
            </button>
          </div>

          {/* Zen Mode toggle */}
          {onZenModeToggle && (
            <div
              role="group"
              aria-label="Zen mode"
              className="flex items-center gap-1 rounded-xl border border-stone-200/80 bg-stone-50/60 p-1"
            >
              <button
                type="button"
                aria-label={zenMode ? "Exit Zen Mode" : "Enter Zen Mode"}
                title={zenMode ? "Exit Zen Mode (Z)" : "Enter Zen Mode (Z)"}
                onClick={onZenModeToggle}
                className={cn(
                  "group relative flex h-10 w-10 items-center justify-center rounded-lg transition-all",
                  zenMode
                    ? "bg-stone-800 text-white shadow-sm"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                )}
              >
                {/* Terracotta tick when active */}
                {zenMode && (
                  <span
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-6 rounded-full bg-[#C47847]"
                    aria-hidden="true"
                  />
                )}
                {zenMode ? (
                  <Minimize2 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          )}

          {/* Dark/light background toggle (Zen Mode only) */}
          {zenMode && onZenDarkBackgroundToggle && (
            <button
              type="button"
              aria-label={zenDarkBackground ? "Switch to light background" : "Switch to dark background"}
              title={zenDarkBackground ? "Light background" : "Dark background"}
              onClick={onZenDarkBackgroundToggle}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200/80 bg-stone-50/60 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
            >
              {zenDarkBackground ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        {/* Keyboard shortcuts legend — toggleable */}
        {showLegend && (
          <div
            role="region"
            aria-label="Keyboard shortcuts"
            className="w-full rounded-xl border border-stone-200/80 bg-stone-50/80 p-3 text-xs text-stone-600"
          >
            <p className="mb-2 font-jakarta font-semibold text-stone-800">Keyboard Shortcuts</p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
              {[
                ["B", "Brush tool"],
                ["F", "Fill tool"],
                ["S", "Select tool"],
                ["P / Space", "Paint"],
                ["Cmd/Ctrl+Z", "Undo"],
                ["+ / -", "Brush size"],
                ["Z", "Zen Mode"],
                ["Esc", "Exit Zen Mode"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center gap-2">
                  <dt className="rounded border border-stone-300 bg-white px-1 font-mono text-stone-500">
                    {key}
                  </dt>
                  <dd>{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </>
  );
}
