"use client";

import { useCallback, useRef, useState } from "react";
import {
  clientPointToCanvas,
  logicalPointToBackingStore,
  type CanvasPoint,
} from "@/lib/canvas-coords";
import { maskGridFromPixels, floodFillMask } from "@/lib/mask-flood-fill";
import { pushMaskSnapshot } from "@/lib/mask-undo-stack";
import type { MaskTool, CopiedMaskRegion } from "./inpaint-mask-canvas";
import type { InstanceOverlay } from "@/lib/instance-overlays";

export interface UseMaskPaintingInput {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** Logical grid + DPR-scaled backing store (issue #181). */
  dims: { width: number; height: number };
  backing: { width: number; height: number };
  devicePixelRatio: number;
  brushSize: number;
  activeTool: MaskTool;
  /** Issue #591 overlay state (selection rect + clipboard + preview). */
  copiedMask: CopiedMaskRegion | null;
  setCopiedMask: (region: CopiedMaskRegion | null) => void;
  selectionRect: { x: number; y: number; width: number; height: number } | null;
  setSelectionRect: (rect: { x: number; y: number; width: number; height: number } | null) => void;
  pastePreview: { x: number; y: number; mirrored: boolean } | null;
  setPastePreview: (preview: { x: number; y: number; mirrored: boolean } | null) => void;
  /** Buffer-hook integration (undo snapshots + export + painted flag). */
  captureUndoState: () => string | null;
  setUndoHistory: React.Dispatch<React.SetStateAction<import("@/lib/mask-undo-stack").MaskUndoHistory>>;
  setHasPainted: (painted: boolean) => void;
  exportMask: () => void;
  exportMaskRef: React.MutableRefObject<() => void>;
  /** Select Objects tool (issue #228). */
  onInstanceToggle?: (point: CanvasPoint) => void;
  segmentDisabled: boolean;
  instanceOverlays?: InstanceOverlay[];
  /** The keyboard cursor (paste-point fallback, late-bound through a ref). */
  keyboardCursorRef: React.MutableRefObject<{ x: number; y: number } | null>;
}

/**
 * Pointer painting for the mask canvas (issue #691 extraction from
 * inpaint-mask-canvas.tsx): coordinate mapping into logical space
 * (#181), brush strokes + dots, the Fill Region flood fill, the #591
 * selection drag / copy / paste cluster, and the #228 instance-click
 * routing for tiny selections.
 */
export function useMaskPainting({
  canvasRef,
  dims,
  backing,
  devicePixelRatio,
  brushSize,
  activeTool,
  copiedMask,
  setCopiedMask,
  selectionRect,
  setSelectionRect,
  pastePreview,
  setPastePreview,
  captureUndoState,
  setUndoHistory,
  setHasPainted,
  exportMask,
  exportMaskRef,
  onInstanceToggle,
  segmentDisabled,
  instanceOverlays,
  keyboardCursorRef,
}: UseMaskPaintingInput) {
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Issue #591: selection drag state (click vs drag disambiguation).
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  // Issue #591: track initial mouse position to distinguish click from drag
  const selectionDragStartRef = useRef<{ x: number; y: number } | null>(null);

  const getCoordinates = useCallback(
    (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();

      // Scale basis (issue #181): pointers map into the LOGICAL canvas space
      // (dims), never the DPR-scaled backing store (canvas.width/height). The
      // context transform carries logical coordinates onto physical pixels,
      // so painted strokes land exactly under the cursor at any device
      // pixel ratio.
      if ("touches" in e) {
        const touch = e.touches[0];
        if (!touch) return null;
        return clientPointToCanvas(touch.clientX, touch.clientY, rect, dims.width, dims.height);
      }

      return clientPointToCanvas(e.clientX, e.clientY, rect, dims.width, dims.height);
    },
    [canvasRef, dims.width, dims.height]
  );

  const draw = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.strokeStyle = "white";
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    },
    [canvasRef, brushSize]
  );

  // A zero-length stroked line renders inconsistently across browsers, so
  // single-point paints (keyboard toggle-down, no movement yet) fill a disc.
  const drawDot = useCallback(
    (at: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(at.x, at.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    [canvasRef, brushSize]
  );

  // Fill Region tool: flood-fills the unpainted region connected to the
  // click/cursor point with painted pixels. Designed for cover-the-object
  // semantics — draw a continuous outline around the object, then fill its
  // interior in one click instead of painting it by hand. Returns true when
  // pixels changed.
  const performFill = useCallback(
    (point: { x: number; y: number }): boolean => {
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;

      // getImageData/putImageData operate on PHYSICAL pixels and ignore the
      // context transform, so the logical-space seed is mapped into backing
      // store pixels before flooding (issue #181).
      const seed = logicalPointToBackingStore(point, devicePixelRatio, backing);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const grid = maskGridFromPixels(imageData.data, canvas.width, canvas.height);
      const result = floodFillMask(grid, canvas.width, canvas.height, seed.x, seed.y);
      if (!result || result.filledCount === 0) return false;

      // Snap filled (and already-painted) cells to pure white so the exported
      // mask keeps clean region-replacement semantics.
      const data = imageData.data;
      for (let i = 0; i < result.mask.length; i++) {
        if (result.mask[i] === 1) {
          const o = i * 4;
          data[o] = 255;
          data[o + 1] = 255;
          data[o + 2] = 255;
          data[o + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      return true;
    },
    [canvasRef, devicePixelRatio, backing]
  );

  // Issue #591: copy selected mask region to clipboard state
  const performCopy = useCallback(() => {
    if (!selectionRect) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y, width: w, height: h } = selectionRect;
    const imageData = ctx.getImageData(
      Math.round(x * backing.width / dims.width),
      Math.round(y * backing.height / dims.height),
      Math.max(1, Math.round(w * backing.width / dims.width)),
      Math.max(1, Math.round(h * backing.height / dims.height))
    );
    setCopiedMask({ imageData, bounds: { x, y, width: w, height: h } });
    setPastePreview(null);
  }, [selectionRect, backing, dims, canvasRef, setCopiedMask, setPastePreview]);

  // Issue #591: paste copied mask region at cursor (optionally mirrored)
  const performPaste = useCallback((mirrored: boolean) => {
    if (!copiedMask) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const undoState = captureUndoState();
    setUndoHistory((prev) => pushMaskSnapshot(prev, undoState));

    const { imageData, bounds } = copiedMask;
    const pasteX = pastePreview?.x ?? (keyboardCursorRef.current?.x ?? bounds.x);
    const pasteY = pastePreview?.y ?? (keyboardCursorRef.current?.y ?? bounds.y);

    const pasteCanvas = document.createElement("canvas");
    pasteCanvas.width = bounds.width;
    pasteCanvas.height = bounds.height;
    const pasteCtx = pasteCanvas.getContext("2d");
    if (!pasteCtx) return;
    pasteCtx.putImageData(imageData, 0, 0);

    // getImageData/putImageData operate in PHYSICAL pixel space (issue #181)
    const physicalPasteX = Math.round(pasteX * backing.width / dims.width);
    const physicalPasteY = Math.round(pasteY * backing.height / dims.height);
    const physicalWidth = Math.round(bounds.width * backing.width / dims.width);
    const physicalHeight = Math.round(bounds.height * backing.height / dims.height);

    if (mirrored) {
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(pasteCanvas, 0, 0, pasteCanvas.width, pasteCanvas.height,
        canvas.width - physicalPasteX - physicalWidth, physicalPasteY,
        physicalWidth, physicalHeight);
      ctx.restore();
    } else {
      ctx.drawImage(pasteCanvas, 0, 0, pasteCanvas.width, pasteCanvas.height,
        physicalPasteX, physicalPasteY, physicalWidth, physicalHeight);
    }

    setHasPainted(true);
    setPastePreview(null);
    exportMaskRef.current();
  }, [copiedMask, pastePreview, backing, dims, captureUndoState, setUndoHistory, setHasPainted, setPastePreview, exportMaskRef, canvasRef, keyboardCursorRef]);

  // Select Objects tool (issue #228): hands the clicked LOGICAL canvas
  // point to the parent, which hit-tests it against the decoded concept
  // instances — zero provider calls per click. Repeated clicks on the
  // same point are meaningful (toggle in/out), so there is no dedupe.
  const handleInstanceClick = useCallback(
    (canvasPoint: CanvasPoint) => {
      if (!onInstanceToggle || segmentDisabled) return;
      onInstanceToggle(canvasPoint);
    },
    [onInstanceToggle, segmentDisabled]
  );

  const handleStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const point = getCoordinates(e);
      if (!point) return;
      if (activeTool === "select") {
        // Issue #591: start selection drag — store start point; handleMove
        // upgrades this to a real selection rect once movement is detected.
        selectionDragStartRef.current = point;
        setIsSelecting(true);
        selectionStartRef.current = point;
        setPastePreview(null);
        return;
      }
      if (activeTool === "fill") {
        // Issue #378: capture undo state before fill
        const undoState = captureUndoState();
        setUndoHistory((prev) => pushMaskSnapshot(prev, undoState));
        if (performFill(point)) {
          setHasPainted(true);
          exportMask();
        }
        return;
      }
      // Issue #378: capture undo state before brush stroke begins
      const undoState = captureUndoState();
      setUndoHistory((prev) => pushMaskSnapshot(prev, undoState));
      setIsDrawing(true);
      lastPointRef.current = point;
      setHasPainted(true);
      draw(point, point);
    },
    [getCoordinates, activeTool, captureUndoState, setUndoHistory, performFill, setHasPainted, exportMask, draw, setPastePreview]
  );

  const handleMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const point = getCoordinates(e);
      if (!point) return;

      // Issue #591: selection dragging — update rect and paste preview
      if (isSelecting && selectionStartRef.current) {
        const start = selectionStartRef.current;
        setSelectionRect({
          x: start.x,
          y: start.y,
          width: point.x - start.x,
          height: point.y - start.y,
        });
        if (copiedMask) {
          setPastePreview({ x: point.x - copiedMask.bounds.width / 2, y: point.y - copiedMask.bounds.height / 2, mirrored: false });
        }
        return;
      }

      // Brush painting
      if (!isDrawing || !lastPointRef.current) return;
      draw(lastPointRef.current, point);
      lastPointRef.current = point;
    },
    [getCoordinates, isSelecting, copiedMask, isDrawing, draw, setSelectionRect, setPastePreview]
  );

  const handleEnd = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      lastPointRef.current = null;
      exportMask();
    }
    // Issue #591: finalize selection rectangle
    if (isSelecting) {
      setIsSelecting(false);
      const startPoint = selectionDragStartRef.current;
      selectionDragStartRef.current = null;
      // A plain click (press + release with no movement while pressed)
      // never sets selectionRect — handleMove's drag branch only runs
      // once the pointer moves with the button held. Treat that null
      // case as a zero-size rect at the start point so the tiny-movement
      // branch below routes the click to the instance toggle (issue
      // #228) instead of silently dropping it. Pixel-exact clicks
      // (automation, keyboard-adjacent input) have zero mid-press
      // movement and were previously lost here (issue #742).
      const rawRect =
        selectionRect ??
        (startPoint
          ? { x: startPoint.x, y: startPoint.y, width: 0, height: 0 }
          : null);
      if (rawRect) {
        // Normalize rect so width/height are always positive
        const normalized = {
          x: rawRect.width < 0 ? rawRect.x + rawRect.width : rawRect.x,
          y: rawRect.height < 0 ? rawRect.y + rawRect.height : rawRect.y,
          width: Math.abs(rawRect.width),
          height: Math.abs(rawRect.height),
        };
        // Tiny movement = treat as an instance click (issue #228) if overlays exist;
        // otherwise treat as a cancelled selection.
        if (normalized.width <= 3 && normalized.height <= 3 && startPoint) {
          if (instanceOverlays && instanceOverlays.length > 0) {
            handleInstanceClick(startPoint);
          }
          setSelectionRect(null);
        } else {
          setSelectionRect(normalized.width > 2 && normalized.height > 2 ? normalized : null);
        }
      }
    }
  }, [isDrawing, isSelecting, selectionRect, instanceOverlays, handleInstanceClick, exportMask, setSelectionRect]);

  return {
    getCoordinates,
    draw,
    drawDot,
    performFill,
    performCopy,
    performPaste,
    handleInstanceClick,
    handleStart,
    handleMove,
    handleEnd,
  };
}
