"use client";

import { Loader2 } from "lucide-react";
import { sliderFillStyle } from "@/lib/precision-slider";
import type { MaskTool } from "./inpaint-mask-canvas";

export interface MaskCanvasToolbarProps {
  /** Issue #560: external active tool takes priority (Zen Mode lifts state to parent). */
  activeTool: MaskTool;
  onSelectTool: (tool: MaskTool) => void;
  /** Issue #228: Select Regions processing indicator on the tool itself. */
  segmenting: boolean;
  segmentDisabled: boolean;
  /** Issue #748: activating Select Regions arms refresh for a lazy base. */
  onSelectRegionsActivate?: () => void;
  /** Brush size slider (external value when Zen Mode lifts it). */
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  /** Clear Mask + Undo/Redo (issue #378/#694, redo per #1223). */
  onClearMask: () => void;
  canUndo: boolean;
  undoCount: number;
  onUndo: () => void;
  canRedo: boolean;
  redoCount: number;
  onRedo: () => void;
  /** Issue #1223: view zoom indicator; hidden at 1.0x, click resets. */
  zoom: number;
  onResetZoom: () => void;
  /** Keyboard-shortcut legend toggle. */
  showLegend: boolean;
  onToggleLegend: () => void;
}

/**
 * The mask canvas bottom toolbar + keyboard-shortcut legend (issue #691
 * extraction from inpaint-mask-canvas.tsx). Issue #317: toolbar wraps at
 * md+ and buttons have min-height 44px for touch. Issue #549: glassmorphic
 * dock with translucent warm backdrop.
 */
export default function MaskCanvasToolbar({
  activeTool,
  onSelectTool,
  segmenting,
  segmentDisabled,
  onSelectRegionsActivate,
  brushSize,
  onBrushSizeChange,
  onClearMask,
  canUndo,
  undoCount,
  onUndo,
  canRedo,
  redoCount,
  onRedo,
  zoom,
  onResetZoom,
  showLegend,
  onToggleLegend,
}: MaskCanvasToolbarProps) {
  return (
    <>
      {/* Issue #317: toolbar wraps at md+ and buttons have min-height 44px for touch.
          Issue #560: toolbar hidden in Zen Mode (ZenModeToolbar takes over). */}
      {/* Issue #549: glassmorphic dock with translucent warm backdrop */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-atelier-taupe/30 bg-white/80 px-4 py-3 backdrop-blur-md shadow-sm">
        <div role="group" aria-label="Mask tool" className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={activeTool === "brush"}
            onClick={() => onSelectTool("brush")}
            className={
              activeTool === "brush"
                ? "relative px-3 py-2 text-sm rounded-md border border-atelier-primary bg-atelier-primary text-white hover:bg-atelier-primary/80 transition-colors md:min-h-[44px] after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:h-[2px] after:w-8 after:bg-atelier-secondary"
                : "px-3 py-2 text-sm rounded-md border border-atelier-taupe/40 bg-white hover:bg-atelier-canvas transition-colors md:min-h-[44px]"
            }
          >
            Brush
          </button>
          <button
            type="button"
            aria-pressed={activeTool === "fill"}
            onClick={() => onSelectTool("fill")}
            className={
              activeTool === "fill"
                ? "relative px-3 py-2 text-sm rounded-md border border-atelier-primary bg-atelier-primary text-white hover:bg-atelier-primary/80 transition-colors md:min-h-[44px] after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:h-[2px] after:w-8 after:bg-atelier-secondary"
                : "px-3 py-2 text-sm rounded-md border border-atelier-taupe/40 bg-white hover:bg-atelier-canvas transition-colors md:min-h-[44px]"
            }
          >
            Fill Region
          </button>
          {/* Issue #228: the Select Objects tool runs SAM 3.1 concept
              detection. The spinner below is THE processing indicator —
              visible on the tool itself while a concept detection runs,
              not just in the editor's status line. */}
          <button
            type="button"
            aria-pressed={activeTool === "select"}
            aria-busy={segmenting}
            disabled={segmentDisabled}
            onClick={() => {
              onSelectTool("select");
              // Issue #748: activating Select Regions is an explicit
              // refresh signal for a lazily-detected base.
              onSelectRegionsActivate?.();
            }}
            className={
              activeTool === "select"
                ? "relative flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-atelier-primary bg-atelier-primary text-white hover:bg-atelier-primary/80 transition-colors disabled:cursor-not-allowed disabled:opacity-60 md:min-h-[44px] after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:h-[2px] after:w-8 after:bg-atelier-secondary"
                : "flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-atelier-taupe/40 bg-white hover:bg-atelier-canvas transition-colors disabled:cursor-not-allowed disabled:opacity-60 md:min-h-[44px]"
            }
          >
            {segmenting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Selecting...
              </>
            ) : (
              "Select Regions"
            )}
          </button>
        </div>

        {/* Issue #549: Precision Inspector slider styling */}
        <label className="flex items-center gap-2 text-sm text-atelier-primary md:min-h-[44px] md:py-1">
          <span className="whitespace-nowrap">Brush Size:</span>
          <div className="relative">
            <input
              type="range"
              min={1}
              max={100}
              value={brushSize}
              onChange={(e) => onBrushSizeChange(Number(e.target.value))}
              className="atelier-slider atelier-slider-tooltip w-24 md:w-32"
              style={sliderFillStyle(brushSize, 1, 100)}
              data-slider-tooltip={`${brushSize}px`}
              aria-label="Brush size"
            />
          </div>
          <span className="w-8 text-right tabular-nums font-medium">{brushSize}</span>
        </label>

        <button
          onClick={onClearMask}
          className="px-3 py-2 text-sm rounded-md border border-atelier-taupe/40 bg-white hover:bg-atelier-canvas transition-colors md:min-h-[44px]"
        >
          Clear Mask
        </button>

        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Cmd/Ctrl+Z)"
          className="px-3 py-2 text-sm rounded-md border border-atelier-taupe/40 bg-white hover:bg-atelier-canvas transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[44px]"
        >
          Undo {undoCount > 0 && `(${undoCount})`}
        </button>

        {/* Issue #1223: Redo mirrors Undo — disabled when the redo stack is
            empty, count badge when not. */}
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Cmd/Ctrl+Shift+Z)"
          className="px-3 py-2 text-sm rounded-md border border-atelier-taupe/40 bg-white hover:bg-atelier-canvas transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[44px]"
        >
          Redo {redoCount > 0 && `(${redoCount})`}
        </button>

        {/* Issue #1223: zoom indicator, hidden at 1.0x; click resets to 1:1. */}
        {zoom !== 1 && (
          <button
            type="button"
            onClick={onResetZoom}
            title="Reset zoom to 1:1"
            aria-label={`Zoom ${zoom.toFixed(1)}x, click to reset to 1:1`}
            className="px-3 py-2 text-sm rounded-md border border-atelier-taupe/40 bg-white font-mono tabular-nums hover:bg-atelier-canvas transition-colors md:min-h-[44px]"
          >
            {zoom.toFixed(1)}&times;
          </button>
        )}

        <button
          onClick={onToggleLegend}
          title="Keyboard shortcuts"
          aria-label={showLegend ? "Hide keyboard shortcuts" : "Show keyboard shortcuts"}
          aria-expanded={showLegend}
          className="px-3 py-2 text-sm rounded-md border border-atelier-taupe/40 bg-white hover:bg-atelier-canvas transition-colors md:min-h-[44px]"
        >
          ?
        </button>
      </div>

      {showLegend && (
        <div
          role="region"
          aria-label="Keyboard shortcuts"
          className="rounded-md border border-atelier-taupe/30 bg-atelier-canvas p-3 text-xs text-atelier-primary"
        >
          <p className="mb-2 font-medium text-atelier-primary">Keyboard Shortcuts</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            <div className="flex items-center gap-2">
              <dt className="font-mono text-atelier-taupe">Arrow keys</dt>
              <dd>Move brush</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="font-mono text-atelier-taupe">Shift + Arrow</dt>
              <dd>Fine movement</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="font-mono text-atelier-taupe">P / Space / Enter</dt>
              <dd>Start / stop painting</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="font-mono text-atelier-taupe">Cmd / Ctrl + Z</dt>
              <dd>Undo</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="font-mono text-atelier-taupe">Cmd / Ctrl + Shift + Z</dt>
              <dd>Redo</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="font-mono text-atelier-taupe">Wheel / pinch</dt>
              <dd>Zoom the canvas</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="font-mono text-atelier-taupe">Middle-drag</dt>
              <dd>Pan the canvas</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="font-mono text-atelier-taupe">+ / -</dt>
              <dd>Brush size</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="font-mono text-atelier-taupe">Cmd / Ctrl + C</dt>
              <dd>Copy mask selection</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="font-mono text-atelier-taupe">Cmd / Ctrl + V</dt>
              <dd>Paste mask</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="font-mono text-atelier-taupe">Cmd / Ctrl + Shift + V</dt>
              <dd>Mirror-paste mask</dd>
            </div>
          </dl>
        </div>
      )}
    </>
  );
}
