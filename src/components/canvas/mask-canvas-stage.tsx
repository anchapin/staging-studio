"use client";

import type { RefObject } from "react";
import type { InstanceOverlay, SelectionMarker } from "@/lib/instance-overlays";
import type { MaskTool } from "./inpaint-mask-canvas";
import {
  MASK_OVERLAY_EMERALD,
  MASK_LASER_RIM_BORDER,
} from "./use-mask-overlay-layer";

export interface MaskCanvasStageProps {
  /** The interactive mask canvas + decorative overlay canvas refs. */
  canvasRef: RefObject<HTMLCanvasElement>;
  overlayCanvasRef: RefObject<HTMLCanvasElement>;
  /** Logical grid + DPR-scaled backing store (issue #181). */
  dims: { width: number; height: number };
  backing: { width: number; height: number };
  hasOverlay: boolean;
  /** Tool-dependent aria label + cursor class (computed by the parent). */
  activeTool: MaskTool;
  cursorClass: string;
  canvasAriaLabel: string;
  maskingHintId: string;
  hintId: string;
  /** Pointer/keyboard handlers (parent-owned). */
  handleStart: (e: React.MouseEvent | React.TouchEvent) => void;
  handleMove: (e: React.MouseEvent | React.TouchEvent) => void;
  handleEnd: () => void;
  handleCanvasKeyDown: (e: React.KeyboardEvent<HTMLCanvasElement>) => void;
  handleCanvasFocus: () => void;
  handleCanvasBlur: () => void;
  /** Virtual brush cursor overlay (keyboard painting). */
  isCanvasFocused: boolean;
  isKeyboardPainting: boolean;
  cursor: { x: number; y: number } | null;
  brushSize: number;
  /** Issue #203: numbered selection badges. */
  selectionMarkers?: SelectionMarker[];
  markerSpace: { width: number; height: number };
  onSelectionDeselect?: (id: string) => void;
  /** Empty-state hint (cover-the-object semantics). */
  hasPainted: boolean;
  segmenting: boolean;
  detectingConcept?: string;
  /** Issue #228 tinted instance overlays (drawn by the overlay layer hook). */
  instanceOverlays?: InstanceOverlay[];
}

/**
 * The mask canvas's interactive stage (issue #691 extraction from
 * inpaint-mask-canvas.tsx): the decorative overlay canvas, the
 * DPR-scaled interactive canvas, the DOM brush-cursor indicator, the
 * #203 numbered selection badges, and the empty-state hint.
 */
export default function MaskCanvasStage({
  canvasRef,
  overlayCanvasRef,
  dims,
  backing,
  hasOverlay,
  cursorClass,
  canvasAriaLabel,
  maskingHintId,
  hintId,
  handleStart,
  handleMove,
  handleEnd,
  handleCanvasKeyDown,
  handleCanvasFocus,
  handleCanvasBlur,
  isCanvasFocused,
  isKeyboardPainting,
  cursor,
  brushSize,
  selectionMarkers,
  markerSpace,
  onSelectionDeselect,
  hasPainted,
  segmenting,
  detectingConcept,
  activeTool,
}: MaskCanvasStageProps) {
  // Issue #203: while a batch selection set exists, numbered badges mark
  // each pending object at its click point. Like the brush cursor this is
  // a DOM overlay — never canvas pixels — so the exported mask stays clean.
  const selectionBadges = (selectionMarkers ?? []).map((marker) => (
    <button
      key={marker.id}
      type="button"
      aria-label={`Deselect region ${marker.index}`}
      onClick={() => onSelectionDeselect?.(marker.id)}
      className="absolute z-20 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-atelier-primary/85 text-[10px] font-semibold leading-none text-white shadow hover:bg-atelier-primary/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-atelier-taupe"
      style={{
        left: `${(marker.x / markerSpace.width) * 100}%`,
        top: `${(marker.y / markerSpace.height) * 100}%`,
      }}
    >
      {marker.index}
    </button>
  ));

  // Brush cursor indicator is a DOM overlay, never canvas pixels, so the
  // exported mask stays clean. Positioned/sized as percentages of the canvas
  // box so it matches the display size in both overlay and standalone modes.
  // Issue #549: Uses electric emerald mask overlay color with laser-rim border
  // for visibility over mixed fabrics and warm woodwork.
  const cursorIndicator =
    isCanvasFocused && cursor ? (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute z-10 rounded-full ${
          isKeyboardPainting ? "bg-white/40" : ""
        }`}
        style={{
          left: `${(cursor.x / dims.width) * 100}%`,
          top: `${(cursor.y / dims.height) * 100}%`,
          width: `${(brushSize / dims.width) * 100}%`,
          height: `${(brushSize / dims.height) * 100}%`,
          transform: "translate(-50%, -50%)",
          backgroundColor: isKeyboardPainting ? undefined : MASK_OVERLAY_EMERALD,
          border: MASK_LASER_RIM_BORDER,
          boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.4)",
        }}
      />
    ) : null;

  return (
    <div
      role="application"
      className={hasOverlay ? "absolute inset-0" : "relative w-fit"}
    >
      {/* Issue #228: tinted per-instance overlays (score-ranked). Decorative
          layer beneath the interactive mask canvas — never export pixels. */}
      <canvas
        ref={overlayCanvasRef}
        width={dims.width}
        height={dims.height}
        aria-hidden="true"
        className={
          hasOverlay
            ? "pointer-events-none absolute inset-0 h-full w-full"
            : "pointer-events-none absolute left-0 top-0"
        }
        style={
          hasOverlay
            ? undefined
            : { width: Math.min(dims.width, 512), height: Math.min(dims.height, 512) }
        }
      />
      <canvas
        ref={canvasRef}
        width={backing.width}
        height={backing.height}
        tabIndex={0}
        aria-label={canvasAriaLabel}
        aria-describedby={`${maskingHintId} ${hintId}`}
        className={
          hasOverlay
            ? `absolute inset-0 h-full w-full rounded-lg ${cursorClass} touch-none opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-atelier-primary focus-visible:ring-offset-2`
            : `border border-atelier-taupe/40 rounded ${cursorClass} touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-atelier-primary focus-visible:ring-offset-2`
        }
        style={
          hasOverlay ? undefined : { width: Math.min(dims.width, 512), height: Math.min(dims.height, 512) }
        }
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        onKeyDown={handleCanvasKeyDown}
        onFocus={handleCanvasFocus}
        onBlur={handleCanvasBlur}
      />
      {cursorIndicator}
      {selectionBadges}

      {/* Empty-state hint: the mask uses cover-the-object semantics, so make
          the first paint action obvious. Hidden once anything is painted. */}
      {!hasPainted && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
        >
          <span
            className={`rounded-md bg-black/60 px-3 py-1.5 text-center text-xs font-medium text-white ${
              hasOverlay ? "" : "border border-white/30"
            }`}
          >
            {segmenting && detectingConcept
              ? `Analyzing room for ${detectingConcept}…`
              : activeTool === "select"
                ? "Click a tinted object to toggle it in the mask"
                : "Drag to paint over the object you want changed"}
          </span>
        </div>
      )}
    </div>
  );
}
