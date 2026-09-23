"use client";

import { useCallback, useRef, useState } from "react";
import type { MaskTool } from "./inpaint-mask-canvas";

/** Point in logical canvas pixel space (same space clientPointToCanvas produces). */
export interface CanvasLogicalPoint {
  x: number;
  y: number;
}

export interface UseMaskKeyboardPaintingInput {
  /** The interactive mask canvas (toggle paints only when it exists). */
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** Logical canvas grid dimensions (issue #181 space). */
  dims: { width: number; height: number };
  activeTool: MaskTool;
  /** Brush stroke / dot painters (logical space, white on black). */
  drawStroke: (from: CanvasLogicalPoint, to: CanvasLogicalPoint) => void;
  drawDot: (at: CanvasLogicalPoint) => void;
  /** Fill Region tool executor; returns true when pixels changed. */
  performFill: (point: CanvasLogicalPoint) => boolean;
  /** Select Objects toggle (issue #228). */
  onInstanceClick: (point: CanvasLogicalPoint) => void;
  /** Re-export after a keyboard paint lifts. */
  exportMask: () => void;
  /** Marks the canvas as painted (coverage/empty-state tracking). */
  setHasPainted: (painted: boolean) => void;
  /** Issue #591: copy/paste executors (selection → clipboard state). */
  performCopy: () => void;
  performPaste: (mirrored: boolean) => void;
  /** Issue #378/#694: undo executor (owns the mask undo stack). */
  handleUndo: () => void;
  /** Issue #560: brush-size stepping writes through (external or internal). */
  getBrushSize: () => number;
  setBrushSize: (size: number) => void;
}

/**
 * Keyboard painting for the mask canvas (issue #691 extraction from
 * inpaint-mask-canvas.tsx): a virtual brush cursor in LOGICAL canvas
 * space (arrow-key deltas scale with canvas resolution, not client
 * pixels — issue #181), P/Space/Enter toggles painting (or fills /
 * toggles the instance under the cursor with the Fill / Select tools),
 * Cmd/Ctrl+C/V/Shift+V drive the #591 copy-paste cluster, Cmd/Ctrl+Z
 * undoes, and +/- steps the brush size.
 */
export function useMaskKeyboardPainting({
  canvasRef,
  dims,
  activeTool,
  drawStroke,
  drawDot,
  performFill,
  onInstanceClick,
  exportMask,
  setHasPainted,
  performCopy,
  performPaste,
  handleUndo,
  getBrushSize,
  setBrushSize,
}: UseMaskKeyboardPaintingInput) {
  const [isCanvasFocused, setIsCanvasFocused] = useState(false);
  const [isKeyboardPainting, setIsKeyboardPainting] = useState(false);
  const [cursor, setCursor] = useState<CanvasLogicalPoint | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const keyboardPaintingRef = useRef(false);

  // The virtual brush cursor lives in canvas pixel space — the same
  // space clientPointToCanvas produces and the DOM cursor indicator
  // positions against (issue #181 keeps it DPR-independent).
  const centerOf = useCallback(
    () => ({
      x: dims.width / 2,
      y: dims.height / 2,
    }),
    [dims.width, dims.height]
  );

  const moveCursorTo = useCallback(
    (next: { x: number; y: number }) => {
      const point = {
        x: Math.min(Math.max(next.x, 0), dims.width),
        y: Math.min(Math.max(next.y, 0), dims.height),
      };
      if (keyboardPaintingRef.current) {
        const from = cursorRef.current ?? point;
        drawStroke(from, point);
      }
      cursorRef.current = point;
      setCursor(point);
    },
    [dims.width, dims.height, drawStroke]
  );

  const liftKeyboardPaint = useCallback(() => {
    if (!keyboardPaintingRef.current) return;
    keyboardPaintingRef.current = false;
    setIsKeyboardPainting(false);
    exportMask();
  }, [exportMask]);

  const toggleKeyboardPaint = useCallback(() => {
    if (!canvasRef.current) return;
    if (activeTool === "select") {
      const at = cursorRef.current ?? centerOf();
      cursorRef.current = at;
      setCursor(at);
      onInstanceClick(at);
      return;
    }
    if (activeTool === "fill") {
      const at = cursorRef.current ?? centerOf();
      cursorRef.current = at;
      setCursor(at);
      if (performFill(at)) {
        setHasPainted(true);
        exportMask();
      }
      return;
    }
    if (keyboardPaintingRef.current) {
      liftKeyboardPaint();
      return;
    }
    const at = cursorRef.current ?? centerOf();
    cursorRef.current = at;
    setCursor(at);
    keyboardPaintingRef.current = true;
    setIsKeyboardPainting(true);
    setHasPainted(true);
    drawDot(at);
  }, [activeTool, canvasRef, centerOf, drawDot, exportMask, liftKeyboardPaint, onInstanceClick, performFill, setHasPainted]);

  const handleCanvasKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      // Issue #591: copy mask selection
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        e.preventDefault();
        performCopy();
        return;
      }

      // Issue #591: paste mask (normal)
      if ((e.metaKey || e.ctrlKey) && e.key === "v" && !e.shiftKey) {
        e.preventDefault();
        performPaste(false);
        return;
      }

      // Issue #591: mirror-paste mask
      if ((e.metaKey || e.ctrlKey) && e.key === "v" && e.shiftKey) {
        e.preventDefault();
        performPaste(true);
        return;
      }

      // Issue #378: Cmd/Ctrl+Z for undo
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
        return;
      }

      const ARROW_DELTAS: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };

      const delta = ARROW_DELTAS[e.key];
      if (delta) {
        e.preventDefault();
        const fraction = e.shiftKey ? 0.01 : 0.05;
        const current = cursorRef.current ?? centerOf();
        moveCursorTo({
          x: current.x + delta[0] * dims.width * fraction,
          y: current.y + delta[1] * dims.height * fraction,
        });
        return;
      }

      if (e.key === "p" || e.key === "P" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggleKeyboardPaint();
        return;
      }

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        const next = Math.min(getBrushSize() + 2, 100);
        setBrushSize(next);
        return;
      }

      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        const next = Math.max(getBrushSize() - 2, 1);
        setBrushSize(next);
        return;
      }
    },
    [centerOf, dims.width, dims.height, getBrushSize, handleUndo, moveCursorTo, performCopy, performPaste, setBrushSize, toggleKeyboardPaint]
  );

  const handleCanvasFocus = useCallback(() => {
    setIsCanvasFocused(true);
    if (!cursorRef.current) {
      const at = centerOf();
      cursorRef.current = at;
      setCursor(at);
    }
  }, [centerOf]);

  const handleCanvasBlur = useCallback(() => {
    setIsCanvasFocused(false);
    liftKeyboardPaint();
  }, [liftKeyboardPaint]);

  return {
    isCanvasFocused,
    isKeyboardPainting,
    cursor,
    cursorRef,
    handleCanvasKeyDown,
    handleCanvasFocus,
    handleCanvasBlur,
  };
}
