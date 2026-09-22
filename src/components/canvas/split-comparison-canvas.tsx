"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Code, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { ComparisonPill } from "./comparison-pill";
import { cn } from "@/lib/utils";
import {
  INITIAL_SPLIT_PERCENT,
  MAX_VISIBLE_VERSION_PILLS,
  beforeLayerInnerWidthPercent,
  clampSplitPercent,
  rangeAriaLabel,
  splitPercentFromClientX,
  visibleVersionPills,
} from "@/lib/split-comparison-canvas";

/**
 * A version pass rendered in the bottom history bar. The Step 3 host
 * (#612) maps these to InpaintRequest results; the canvas itself stays
 * presentational.
 */
export interface SplitComparisonVersion {
  id: string;
}

interface SplitComparisonCanvasProps {
  /** Raw vacant room photo (Before). */
  beforeImageUrl: string;
  beforeAlt: string;
  /** AI-staged result (After). */
  afterImageUrl: string;
  afterAlt: string;
  beforeLabel?: string;
  afterLabel?: string;
  /** Divider start position; defaults to the spec'd 42%. */
  initialSplitPercent?: number;
  /** Version passes shown in the bottom history bar. Empty/omitted hides the bar. */
  versions?: readonly SplitComparisonVersion[];
  activeVersionId?: string | null;
  onSelectVersion?: (id: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onReset?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  className?: string;
}

/**
 * SplitComparisonCanvas — Brush Refinement Studio (Step 3) center canvas
 * (issue #618).
 *
 * Layer stack (bottom → top):
 *  1. After image — full-bleed background (object-cover)
 *  2. Before clip layer — absolute, overflow-hidden, width = split%,
 *     2px terracotta border-right acting as the split line
 *  3. Invisible native range input (z-20) — keyboard/touch accessible
 *     alternative to dragging the handle
 *  4. Split handle (z-30) — 28px circular bg-primary disc, white icon,
 *     cursor-ew-resize, scales on hover
 *  5. Label pills + bottom version history bar (z-30)
 *
 * Desktop polish: hovering the canvas WITHOUT dragging moves the split
 * to the pointer's X position (gated on hover-capable fine pointers so
 * touch devices don't fight the native range drag).
 */
export default function SplitComparisonCanvas({
  beforeImageUrl,
  beforeAlt,
  afterImageUrl,
  afterAlt,
  beforeLabel = "Before",
  afterLabel = "After",
  initialSplitPercent = INITIAL_SPLIT_PERCENT,
  versions,
  activeVersionId,
  onSelectVersion,
  onUndo,
  onRedo,
  onReset,
  canUndo = false,
  canRedo = false,
  className,
}: SplitComparisonCanvasProps) {
  const [splitPercent, setSplitPercent] = useState(() =>
    clampSplitPercent(initialSplitPercent)
  );
  const [isDragging, setIsDragging] = useState(false);
  const [hoverUpdateEnabled, setHoverUpdateEnabled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /* Desktop-only hover-position preview (issue #618, Screen 4 polish). */
  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setHoverUpdateEnabled(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const updateFromPointer = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSplitPercent(splitPercentFromClientX(clientX, rect));
  }, []);

  /* Drag tracking: mousedown on the handle starts the drag; mousemove on
     the container (or window, so the drag survives leaving the canvas)
     updates the split; mouseup anywhere stops it. */
  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => updateFromPointer(e.clientX);
    const handleUp = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDragging, updateFromPointer]);

  const pills = visibleVersionPills(versions ?? []);
  const showHistoryBar = pills.length > 0;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full select-none overflow-hidden rounded-lg",
        className
      )}
      onMouseMove={(e) => {
        if (!isDragging && hoverUpdateEnabled) updateFromPointer(e.clientX);
      }}
    >
      {/* After layer (background): full staged image beneath the clip. */}
      <Image
        src={afterImageUrl}
        alt={afterAlt}
        fill
        sizes="100vw"
        className="object-cover"
        priority
      />

      {/* Before layer (foreground): clipped by the split width. The inner
          holder is counter-scaled so the Before photo stays aligned with
          the After image instead of squashing. */}
      <div
        className="absolute inset-y-0 left-0 overflow-hidden border-r-2 border-secondary"
        style={{ width: `${splitPercent}%` }}
        data-testid="split-before-layer"
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${beforeLayerInnerWidthPercent(splitPercent)}%` }}
        >
          <Image
            src={beforeImageUrl}
            alt={beforeAlt}
            fill
            sizes="100vw"
            className="object-cover"
          />
        </div>
      </div>

      {/* Accessible alternative: invisible native range input covering the
          full canvas. Keyboard arrows / touch drag move the split. */}
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={splitPercent}
        onChange={(e) => setSplitPercent(clampSplitPercent(e.target.valueAsNumber))}
        aria-label={rangeAriaLabel(beforeLabel, afterLabel)}
        data-testid="split-range-input"
        className="absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0"
      />

      {/* Draggable divider: circular handle centered on the split line. */}
      <div
        className="pointer-events-none absolute inset-y-0 z-30 w-0"
        style={{ left: `${splitPercent}%` }}
        data-testid="split-divider"
      >
        <button
          type="button"
          aria-label={rangeAriaLabel(beforeLabel, afterLabel)}
          className="pointer-events-auto absolute left-0 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          data-testid="split-handle"
        >
          <Code className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Label pills: Before top-left (studio dark), After top-right
          (surface + terracotta dot, per issue spec). */}
      <div className="pointer-events-none absolute left-3 top-3 z-10">
        <ComparisonPill variant="studio">{beforeLabel}</ComparisonPill>
      </div>
      <div className="pointer-events-none absolute right-3 top-3 z-10">
        <ComparisonPill variant="report" showDot>
          {afterLabel}
        </ComparisonPill>
      </div>

      {/* Version history bar: pinned to the bottom of the canvas
          container, frosted pill surface. */}
      {showHistoryBar && (
        <div
          className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2"
          data-testid="split-history-bar"
        >
          <div className="flex items-center gap-2 rounded-full bg-surface-container-lowest/90 px-4 py-2 shadow-sm backdrop-blur-md">
            <span className="text-xs font-semibold uppercase tracking-wider text-taupe">
              Passes:
            </span>
            <div className="flex items-center gap-1" role="tablist" aria-label="Version passes">
              {pills.map(({ item, label }) => {
                const isActive = item.id === activeVersionId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => onSelectVersion?.(item.id)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-taupe hover:bg-surface-container hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="mx-1 h-4 w-px bg-outline-variant/50" aria-hidden="true" />
            <button
              type="button"
              aria-label="Undo"
              title="Undo"
              disabled={!canUndo}
              onClick={onUndo}
              className="flex h-7 w-7 items-center justify-center rounded-full text-taupe transition-colors hover:bg-surface-container hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Redo"
              title="Redo"
              disabled={!canRedo}
              onClick={onRedo}
              className="flex h-7 w-7 items-center justify-center rounded-full text-taupe transition-colors hover:bg-surface-container hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Reset"
              title="Reset"
              onClick={onReset}
              className="flex h-7 w-7 items-center justify-center rounded-full text-taupe transition-colors hover:bg-surface-container hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { MAX_VISIBLE_VERSION_PILLS };
