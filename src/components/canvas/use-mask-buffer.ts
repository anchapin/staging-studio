"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { estimateMaskCoverage, shouldWarnLowCoverage } from "@/lib/mask-coverage";
import { maskGridFromPixels } from "@/lib/mask-flood-fill";
import {
  canUndoMask,
  emptyMaskUndoHistory,
  maskUndoCount,
  pushMaskSnapshot,
  undoMaskSnapshot,
  type MaskUndoHistory,
} from "@/lib/mask-undo-stack";
import {
  dilateMaskGridDirectional,
} from "@/lib/mask-dilation";
import { fillHoles } from "@/lib/mask-postprocess";
import type { SelectionReset } from "./inpaint-mask-canvas";

export interface UseMaskBufferInput {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** Logical grid + DPR-scaled backing store (issue #181). */
  dims: { width: number; height: number };
  backing: { width: number; height: number };
  overlayImageSrc?: string | null;
  initialMaskDataUrl?: string | null;
  onMaskChange?: (maskDataUrl: string | null) => void;
  /** Export targets the photo's natural dimensions. */
  naturalWidth?: number | null;
  naturalHeight?: number | null;
  /** Issue #180/#234: dilation settings applied at export time. */
  expansionRadius: number;
  includeFloorShadow: boolean;
  /** Issue #203: replace the grid with the union mask on reset-id change. */
  selectionReset: SelectionReset | null;
  /** Issue #203: the user pressed Clear Mask. */
  onMaskCleared?: () => void;
}

/**
 * The mask canvas's pixel buffer lifecycle (issue #691 extraction from
 * inpaint-mask-canvas.tsx — the `useMaskBuffer` the #691 acceptance
 * criteria name): grid init/re-init, stroke preservation across aspect
 * resolution (#262), the #203 selection-set sync, Clear Mask, the
 * dilate→fill export pipeline (#180/#234/#252 D3), and the #378/#694
 * undo stack.
 */
export function useMaskBuffer({
  canvasRef,
  dims,
  backing,
  overlayImageSrc,
  initialMaskDataUrl,
  onMaskChange,
  naturalWidth,
  naturalHeight,
  expansionRadius,
  includeFloorShadow,
  selectionReset,
  onMaskCleared,
}: UseMaskBufferInput) {
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(initialMaskDataUrl ?? null);
  const [hasPainted, setHasPainted] = useState(false);
  const [lowCoverage, setLowCoverage] = useState(false);

  // Issue #694: undo history stack for mask operations — the pure
  // push/cap/undo logic lives in lib/mask-undo-stack.ts. Each entry is a
  // snapshot of the canvas content before a painting operation (brush stroke,
  // fill, clear, or paste). Undo pops the stack to restore a previous state.
  // The component wires undo only (no redo affordance yet), so its undo
  // calls discard the popped snapshot exactly as they did pre-extraction.
  const [undoHistory, setUndoHistory] = useState<MaskUndoHistory>(emptyMaskUndoHistory);

  // Latest initial mask without making initCanvas depend on it — re-running
  // init on every parent render would wipe in-progress strokes.
  const initialMaskRef = useRef(initialMaskDataUrl);
  useEffect(() => {
    initialMaskRef.current = initialMaskDataUrl;
  }, [initialMaskDataUrl]);

  // Issue #262: preserve mask strokes when the canvas grid re-sizes due to
  // the source photo's aspect ratio finally resolving (null → real value).
  // Painting during the load window is now either preserved or visibly impossible
  // (disabled) — never silently lost.
  //
  // When dims change we capture the current canvas content BEFORE initCanvas
  // wipes it, then replay it scaled onto the new grid after initCanvas runs.
  // A ref keeps `hasPainted` current for the effect without adding it as a
  // reactive dependency. We also track the previous overlayImageSrc so we skip
  // preservation when the source image itself changed (a mask is tied to one
  // source image and must not survive onto a different image — issue #170).
  const prevDimsRef = useRef(dims);
  const prevOverlayRef = useRef(overlayImageSrc);
  const hasPaintedRef = useRef(hasPainted);
  useEffect(() => {
    hasPaintedRef.current = hasPainted;
  }, [hasPainted]);

  useEffect(() => {
    const prev = prevDimsRef.current;
    const prevOverlay = prevOverlayRef.current;

    // Skip preservation when the source image changed — a mask belongs to one
    // image and must not leak onto a different image's canvas (issue #170).
    const sourceChanged = overlayImageSrc !== prevOverlay;

    if (prev.width === dims.width && prev.height === dims.height) {
      // Dims unchanged — still update refs so next dims change is clean.
      prevDimsRef.current = dims;
      prevOverlayRef.current = overlayImageSrc;
      return;
    }

    // Dims changed — capture existing strokes before initCanvas wipes them.
    // Capture the painting state HERE (not inside the deferred restore) because
    // initCanvas resets hasPainted to false and the ref sync effect runs after
    // we return, so hasPaintedRef.current would be stale by the time restore
    // executes via queueMicrotask.
    const wasPainted = hasPaintedRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const oldDims = prev;
    const newDims = dims;

    // Only preserve strokes when the source image is the same (aspect ratio
    // resize), not when switching images (source switch wipes intentionally).
    const capturedDataUrl =
      !sourceChanged && wasPainted && canvas && ctx
        ? canvas.toDataURL("image/png")
        : null;

    prevDimsRef.current = newDims;
    prevOverlayRef.current = overlayImageSrc;

    if (!capturedDataUrl) return;

    // Defer the restore until after initCanvas has set up the new grid.
    const restore = () => {
      const c = canvasRef.current;
      const cg = c?.getContext("2d");
      if (!c || !cg) return;
      const img = new Image();
      img.onload = () => {
        cg.drawImage(img, 0, 0, oldDims.width, oldDims.height, 0, 0, newDims.width, newDims.height);
      };
      img.src = capturedDataUrl;
    };

    // queueMicrotask runs after the current synchronous chunk (both effects
    // complete) but before the browser renders — initCanvas effect is already
    // done by the time restore fires.
    queueMicrotask(restore);
  }, [dims, overlayImageSrc, canvasRef]);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Painting stays in logical (dims) coordinates; this transform maps it
    // onto the DPR-scaled backing store. Setting the canvas size (below,
    // via React) resets the context, so re-apply it on every (re)init.
    const dpr = backing.width / dims.width || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const initial = initialMaskRef.current;
    if (initial) {
      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, dims.width, dims.height);
        ctx.drawImage(img, 0, 0, dims.width, dims.height);
      };
      img.src = initial;
    } else {
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, dims.width, dims.height);
    }
    // Re-initializing replaces the canvas content, so reset the guidance
    // state to match what will actually be on screen.
    setHasPainted(Boolean(initial));
    setLowCoverage(false);
  }, [dims.width, dims.height, backing, canvasRef]);

  // Initialize once on mount, and re-initialize when the geometry changes
  // (e.g. the photo's aspect ratio resolves after the image loads) or when
  // the underlying photo itself changes (issue #170 source switching) — a
  // mask drawn for one image must never survive onto the next. The ref sync
  // effect above runs first, so initCanvas reads the latest initial mask.
  useEffect(() => {
    // Issue #262: track source changes so the dims-change effect above can
    // distinguish aspect-ratio resize (preserve strokes) from source switch
    // (don't preserve — mask belongs to the old image).
    if (overlayImageSrc !== prevOverlayRef.current) {
      prevOverlayRef.current = overlayImageSrc;
    }
    initCanvas();
  }, [initCanvas, overlayImageSrc]);

  // Issue #378: capture the current canvas content as a data URL for the undo
  // stack. Called before any destructive operation (stroke, fill, clear).
  const captureUndoState = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.toDataURL("image/png");
  }, [canvasRef]);

  // Issue #378: restore a previously captured undo state back onto the canvas.
  const restoreUndoState = useCallback((dataUrl: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, dims.width, dims.height);
      ctx.drawImage(img, 0, 0, dims.width, dims.height);
    };
    img.src = dataUrl;
    return true;
  }, [dims.width, dims.height, canvasRef]);

  // Issue #378: pop the most recent undo state and restore it. Called both
  // from the explicit Undo button and from the Cmd/Ctrl+Z keyboard shortcut.
  const handleUndo = useCallback(() => {
    const { history, snapshot: previousState } = undoMaskSnapshot(undoHistory);
    if (previousState === null) return;
    if (restoreUndoState(previousState)) {
      setUndoHistory(history);
      // After restore, re-export to notify parent and update coverage warning
      // Use a microtask to ensure canvas is painted before exporting
      queueMicrotask(() => {
        const currentDataUrl = canvasRef.current?.toDataURL("image/png") ?? null;
        setMaskDataUrl(currentDataUrl);
        onMaskChange?.(currentDataUrl);
        // Update hasPainted based on whether there's any content
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            let hasContent = false;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0) {
                hasContent = true;
                break;
              }
            }
            setHasPainted(hasContent);
          }
        }
      });
    }
  }, [undoHistory, restoreUndoState, onMaskChange, canvasRef]);

  const exportMask = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // fal-ai/flux-fill expects the mask geometry to match the source image,
    // so rescale the painted mask to the photo's natural pixel dimensions.
    const exportWidth =
      naturalWidth && naturalWidth > 0 ? Math.max(1, Math.round(naturalWidth)) : canvas.width;
    const exportHeight =
      naturalHeight && naturalHeight > 0 ? Math.max(1, Math.round(naturalHeight)) : canvas.height;

    // Issue #180: grow the painted mask outward before export so bezels,
    // frames, brackets, and mounts at the painted boundary are regenerated
    // instead of preserved. Dilation runs in logical mask-canvas pixel space
    // (dims) BEFORE the scale-to-natural-dimensions step and only rewrites
    // mask pixels — the source photo is never touched. A radius of 0 keeps
    // the un-dilated mask.
    //
    // Issue #252 D3: filling runs LAST in the composition pipeline —
    // dilation can seal unpainted pockets — so every manual mask reaching
    // /api/inpaint is hole-free ("no donut reaches FLUX"). Strokes stay raw
    // while drawing; this is the run-composition point.
    let maskSource: HTMLCanvasElement = canvas;
    {
      const paint = document.createElement("canvas");
      paint.width = dims.width;
      paint.height = dims.height;
      const paintCtx = paint.getContext("2d");
      if (!paintCtx) return;
      paintCtx.drawImage(canvas, 0, 0, dims.width, dims.height);
      const paintData = paintCtx.getImageData(0, 0, dims.width, dims.height);
      const grid = maskGridFromPixels(paintData.data, dims.width, dims.height);
      // Issue #234: directional dilation extends further downward when
      // includeFloorShadow is true, swallowing cast shadows on the floor.
      const dilated = dilateMaskGridDirectional(grid, dims.width, dims.height, expansionRadius, {
        includeFloorShadow,
      });
      if (!dilated) return;
      const baseMask = dilated.mask;
      const filled = fillHoles(baseMask, dims.width, dims.height);
      const finalMask = filled ? filled.mask : baseMask;

      const grown = paintCtx.createImageData(dims.width, dims.height);
      const grownData = grown.data;
      for (let i = 0; i < finalMask.length; i++) {
        const o = i * 4;
        if (finalMask[i] === 1) {
          grownData[o] = 255;
          grownData[o + 1] = 255;
          grownData[o + 2] = 255;
        }
        grownData[o + 3] = 255;
      }
      paintCtx.putImageData(grown, 0, 0);
      maskSource = paint;
    }

    let dataUrl: string;
    if (exportWidth === maskSource.width && exportHeight === maskSource.height) {
      dataUrl = maskSource.toDataURL("image/png");
    } else {
      const scaled = document.createElement("canvas");
      scaled.width = exportWidth;
      scaled.height = exportHeight;
      const scaledCtx = scaled.getContext("2d");
      if (!scaledCtx) return;
      scaledCtx.drawImage(maskSource, 0, 0, exportWidth, exportHeight);
      dataUrl = scaled.toDataURL("image/png");
    }

    setMaskDataUrl(dataUrl);
    onMaskChange?.(dataUrl);

    // Surface a low-coverage warning when the mask looks like a stray stroke
    // or an outline-only mistake (cover-the-object semantics). Coverage is a
    // ratio, so reading it from the paint canvas is equivalent to reading it
    // from the scaled export.
    if (ctx) {
      const coverage = estimateMaskCoverage(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height
      );
      setLowCoverage(shouldWarnLowCoverage(coverage));
    }
  }, [naturalWidth, naturalHeight, onMaskChange, expansionRadius, includeFloorShadow, dims.width, dims.height, canvasRef]);

  // Keep a ref to the latest exportMask so copy/paste callbacks don't go stale
  const exportMaskRef = useRef(exportMask);
  useEffect(() => {
    exportMaskRef.current = exportMask;
  }, [exportMask]);

  // Re-export when the expansion radius changes so the dispatched mask
  // always reflects the current dilation setting (issue #180). Refs keep the
  // effect from firing on mount or on unrelated geometry changes — the mask
  // is only re-exported once something has actually been painted.
  const lastAppliedRadiusRef = useRef(expansionRadius);
  const lastAppliedIncludeFloorShadowRef = useRef(includeFloorShadow);
  useEffect(() => {
    const previous = lastAppliedRadiusRef.current;
    lastAppliedRadiusRef.current = expansionRadius;
    if (previous === expansionRadius) return;
    if (!hasPaintedRef.current) return;
    exportMask();
  }, [expansionRadius, exportMask]);

  // Issue #234: also re-export when includeFloorShadow toggles so the
  // dispatched mask always reflects the current directional setting.
  useEffect(() => {
    const previous = lastAppliedIncludeFloorShadowRef.current;
    lastAppliedIncludeFloorShadowRef.current = includeFloorShadow;
    if (previous === includeFloorShadow) return;
    if (!hasPaintedRef.current) return;
    exportMask();
  }, [includeFloorShadow, exportMask]);

  const clearMask = useCallback(() => {
    // Issue #378: capture undo state before clearing so it can be undone
    const undoState = captureUndoState();
    setUndoHistory((prev) => pushMaskSnapshot(prev, undoState));
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, dims.width, dims.height);
    setMaskDataUrl(null);
    setHasPainted(false);
    setLowCoverage(false);
    onMaskChange?.(null);
    // Issue #203: the grid is now empty — the parent must drop the batch
    // selection set so the panel can't disagree with the canvas (the
    // resulting empty-set reset below re-initializes to black, idempotent).
    onMaskCleared?.();
  }, [captureUndoState, dims.width, dims.height, onMaskChange, onMaskCleared, canvasRef]);

  // Issue #203: batch selection sync — replaces the #183 incremental
  // segment merge. The grid must always equal the union of the current
  // selection set, so ANY set change (add, undo-last, remove, clear)
  // re-initializes the grid from the editor-composed union mask instead of
  // merging (removals cannot be un-painted, and re-composing keeps the
  // grid provably consistent with the panel's list). Manual strokes made
  // on top of a selection are rebuilt away by design: while the selection
  // set exists it is the source of truth (the batch panel says so).
  const lastAppliedResetRef = useRef<number>(-1);
  useEffect(() => {
    if (!selectionReset || selectionReset.id === lastAppliedResetRef.current) return;
    lastAppliedResetRef.current = selectionReset.id;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    if (!selectionReset.maskDataUrl) {
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, dims.width, dims.height);
      setMaskDataUrl(null);
      setHasPainted(false);
      setLowCoverage(false);
      onMaskChange?.(null);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, dims.width, dims.height);
      ctx.drawImage(img, 0, 0, dims.width, dims.height);
      setHasPainted(true);
      exportMask();
    };
    img.src = selectionReset.maskDataUrl;
    return () => {
      cancelled = true;
    };
  }, [selectionReset, dims.width, dims.height, exportMask, onMaskChange, canvasRef]);

  return {
    maskDataUrl,
    setMaskDataUrl,
    hasPainted,
    setHasPainted,
    lowCoverage,
    undoHistory,
    setUndoHistory,
    captureUndoState,
    handleUndo,
    exportMask,
    exportMaskRef,
    clearMask,
    canUndo: canUndoMask(undoHistory),
    undoCount: maskUndoCount(undoHistory),
  };
}
