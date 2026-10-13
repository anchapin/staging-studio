"use client";

import { useRef, useState, useEffect, useLayoutEffect, useMemo, useId, useCallback } from "react";
import { computeBackingStoreDimensions, computeMaskCanvasDimensions } from "@/lib/canvas-coords";
import { DEFAULT_MASK_EXPANSION_RADIUS } from "@/lib/mask-dilation";
import {
  useMaskBuffer,
} from "./use-mask-buffer";
import { useMaskOverlayLayer } from "./use-mask-overlay-layer";
import { useMaskKeyboardPainting } from "./use-mask-keyboard-painting";
import { useMaskPainting } from "./use-mask-painting";
import MaskCanvasToolbar from "./mask-canvas-toolbar";
import MaskCanvasStage from "./mask-canvas-stage";
import type { InpaintMaskCanvasProps } from "./inpaint-mask-canvas-props";

/** Tools for building the mask: freehand paint, flood-fill, or concept select. */
export type MaskTool = "brush" | "fill" | "select";

/** Issue #591: a copied mask region — stored as an RGBA ImageData snapshot. */
export interface CopiedMaskRegion {
  /** Snapshot of the selected rectangle at canvas (logical) resolution. */
  imageData: ImageData;
  /** Bounding box in logical canvas pixels. */
  bounds: { x: number; y: number; width: number; height: number };
}

// Issue #691: the overlay constants, palette, and descriptor shapes moved
// to dedicated modules (pure builders + 1:1 pins); re-exported here to
// keep this module's long-standing export surface stable.
export {
  MASK_OVERLAY_EMERALD,
  MASK_OVERLAY_AMBER,
  MASK_LASER_RIM_BORDER,
  INSTANCE_OVERLAY_PALETTE,
  paletteCssColor,
} from "./use-mask-overlay-layer";
import type { InstanceOverlay, SelectionMarker } from "@/lib/instance-overlays";
export type { InstanceOverlay, SelectionMarker };

/**
 * Issue #203: editor-side sync of the batch selection set. Whenever `id`
 * changes, the mask grid is re-initialized from `maskDataUrl` — the union
 * of every pending selection (or cleared when null). The grid is REPLACED
 * rather than merged because removals cannot be un-painted. A single
 * Select Object click (issue #183 flow) is the one-element case.
 */
export interface SelectionReset {
  id: number;
  maskDataUrl: string | null;
}

export default function InpaintMaskCanvas({
  width = 512,
  height = 512,
  brushSize: externalBrushSize,
  onBrushSizeChange,
  initialMaskDataUrl,
  onMaskChange,
  aspectRatio,
  naturalWidth,
  naturalHeight,
  overlayImageSrc,
  fullWidth = false,
  onInstanceToggle,
  segmentDisabled = false,
  processing = false,
  segmenting = false,
  instanceOverlays,
  expansionRadius = DEFAULT_MASK_EXPANSION_RADIUS,
  includeFloorShadow = false,
  selectionMarkers,
  selectionReset = null,
  onMaskCleared,
  onSelectionDeselect,
  detectingConcept,
  activeTool: externalActiveTool,
  onActiveToolChange,
  onSelectRegionsActivate,
  zenMode = false,
}: InpaintMaskCanvasProps) {
  // React 19 tightens `useRef<T>(null)` to return `RefObject<T | null>`; the
  // canvas ref is naturally nullable (mounts late, may unmount) so we declare
  // the nullability explicitly and the consumers in `useMaskBuffer`,
  // `useMaskPainting`, `useMaskKeyboardPainting`, and `MaskCanvasStage` all
  // accept `RefObject<HTMLCanvasElement | null>`.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Issue #560: external brush size takes priority (Zen Mode lifts state to parent).
  const [internalBrushSize, setInternalBrushSize] = useState(externalBrushSize ?? 20);
  const brushSize = externalBrushSize ?? internalBrushSize;

  // Issue #560: external active tool takes priority (Zen Mode lifts state to parent).
  const [internalActiveTool, setInternalActiveTool] = useState<MaskTool>("brush");
  const activeTool = externalActiveTool ?? internalActiveTool;

  const hintId = useId();
  const maskingHintId = useId();
  const [showLegend, setShowLegend] = useState(false);

  // Canvas resolution follows the photo's aspect ratio (capped on the long
  // edge); without one, fall back to the plain width/height props.
  const dims = useMemo(
    () =>
      aspectRatio && aspectRatio > 0
        ? computeMaskCanvasDimensions(aspectRatio)
        : { width, height },
    [aspectRatio, width, height]
  );

  // HiDPI support (issue #181): all painting happens in LOGICAL canvas
  // space (dims, the same space clientPointToCanvas produces). The backing
  // store is scaled up to device pixels and the 2D context is transformed
  // by the same ratio, so strokes render crisp at native resolution and
  // pointer coordinates land under the cursor on any display scaling.
  // devicePixelRatio is read after mount (SSR/pre-hydration renders as 1)
  // and tracked across zoom / monitor changes via resize.
  const [devicePixelRatio, setDevicePixelRatio] = useState(1);
  useEffect(() => {
    const syncRatio = () => setDevicePixelRatio(window.devicePixelRatio || 1);
    syncRatio();
    window.addEventListener("resize", syncRatio);
    return () => window.removeEventListener("resize", syncRatio);
  }, []);
  useLayoutEffect(() => {
    const syncRatio = () => setDevicePixelRatio(window.devicePixelRatio || 1);
    syncRatio();
    window.addEventListener("resize", syncRatio);
    return () => window.removeEventListener("resize", syncRatio);
  }, []);

  const backing = useMemo(
    () => computeBackingStoreDimensions(dims.width, dims.height, devicePixelRatio),
    [dims.width, dims.height, devicePixelRatio]
  );

  const hasOverlay = Boolean(overlayImageSrc);

  // Issue #252 D5/AC-L1: in the laptop-fixed editor the photo stack must
  // fit the height the layout actually gives it (page-level scrolling is
  // gone at lg+), not just its width. The aspect wrapper is width-fit by
  // default, which overflows a short container; measuring the scroll host
  // lets the wrapper shrink so the whole canvas stays visible and paintable
  // (a clipped canvas swallows pointer events below the fold). Purely
  // presentational: display size only, backing store and mask math are
  // untouched.
  const photoStackRef = useRef<HTMLDivElement | null>(null);
  const hintRef = useRef<HTMLParagraphElement | null>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!fullWidth || !hasOverlay) {
      setFitWidth(null);
      return;
    }
    const stack = photoStackRef.current;
    const host = stack?.parentElement?.parentElement ?? null; // the flex-1 scroll container
    if (!stack || !host) return;

    const measure = () => {
      const hostBox = host.getBoundingClientRect();
      if (hostBox.height <= 0) return;
      const reserved = (hintRef.current?.offsetHeight ?? 0) + 16; // hint + flex gap
      const availableHeight = Math.max(120, hostBox.height - reserved);
      const aspect = dims.width > 0 && dims.height > 0 ? dims.width / dims.height : 1;
      const fitted = Math.min(hostBox.width, availableHeight * aspect);
      setFitWidth(Math.max(160, Math.floor(fitted)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fullWidth, hasOverlay, dims.width, dims.height]);

  // Issue #691: the pixel buffer lifecycle (init, #262 stroke preservation,
  // #203 selection sync, export pipeline, undo) lives in use-mask-buffer.
  const {
    maskDataUrl,
    hasPainted,
    setHasPainted,
    lowCoverage,
    setUndoHistory,
    captureUndoState,
    handleUndo,
    handleRedo,
    exportMask,
    exportMaskRef,
    clearMask,
    canUndo,
    undoCount,
    canRedo,
    redoCount,
  } = useMaskBuffer({
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
  });

  // Issue #691: the decorative overlay layer (instance tints, #591
  // selection rectangle + paste preview) lives in use-mask-overlay-layer.
  const {
    overlayCanvasRef,
    copiedMask,
    setCopiedMask,
    selectionRect,
    setSelectionRect,
    pastePreview,
    setPastePreview,
  } = useMaskOverlayLayer({ dims, instanceOverlays });

  // Issue #691: pointer painting (strokes, fill, copy/paste, instance
  // clicks) lives in use-mask-painting. The paste-point fallback reads the
  // keyboard cursor through a late-bound ref owned here.
  const keyboardCursorRef = useRef<{ x: number; y: number } | null>(null);
  const {
    draw,
    drawDot,
    performFill,
    performCopy,
    performPaste,
    handleInstanceClick,
    handleStart,
    handleMove,
    handleEnd,
  } = useMaskPainting({
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
  });

  // Issue #203: badge space — natural photo pixels when known, else grid.
  const markerSpace = {
    width: naturalWidth && naturalWidth > 0 ? naturalWidth : dims.width,
    height: naturalHeight && naturalHeight > 0 ? naturalHeight : dims.height,
  };

  // Issue #202: while a segment request is in flight the canvas cursor
  // switches to wait — the click registered and processing is happening.
  const cursorClass = segmenting
    ? "cursor-wait"
    : activeTool === "fill"
      ? "cursor-cell"
      : "cursor-crosshair";

  const canvasAriaLabel =
    activeTool === "fill"
      ? "Room mask canvas with the Fill Region tool active: draw a continuous outline around the object, arrow keys move the cursor, press P, Space, or Enter to fill the region under the cursor"
      : activeTool === "select"
        ? "Room mask canvas with the Select Regions tool active: detected instances show as faint tinted shapes with colored outlines, selected instances as solid fills — click one to toggle its shape in or out of the mask (clicks are free — detection already ran per concept), arrow keys move the cursor, press P, Space, or Enter to toggle the instance under the cursor"
        : "Room mask painting canvas: arrow keys move the brush (hold Shift for fine steps), press P, Space, or Enter to start and stop painting";

  // Issue #691: the virtual brush cursor + keyboard painting live in
  // use-mask-keyboard-painting. The +/- steps compute from the INTERNAL
  // brush size and write through the external handler when Zen Mode has
  // lifted the state — exactly as the original handler did.
  const {
    isCanvasFocused,
    isKeyboardPainting,
    cursor,
    cursorRef,
    handleCanvasKeyDown,
    handleCanvasFocus,
    handleCanvasBlur,
  } = useMaskKeyboardPainting({
    canvasRef,
    dims,
    activeTool,
    drawStroke: draw,
    drawDot,
    performFill,
    onInstanceClick: handleInstanceClick,
    exportMask,
    setHasPainted,
    performCopy,
    performPaste,
    handleUndo,
    handleRedo,
    getBrushSize: () => internalBrushSize,
    setBrushSize: (next) => {
      if (onBrushSizeChange) {
        onBrushSizeChange(next);
      } else {
        setInternalBrushSize(next);
      }
    },
  });
  keyboardCursorRef.current = cursorRef.current;

  // Issue #1223: view-state zoom + pan. The transform lives on a wrapper
  // div, never on the mask buffer, so zooming re-renders no mask pixels.
  // Painting stays correct while zoomed: the handlers map client points
  // through the canvas's getBoundingClientRect, which scales with the CSS
  // transform, so strokes land under the cursor at any zoom.
  const MIN_MASK_ZOOM = 0.25;
  const MAX_MASK_ZOOM = 8;
  const [maskZoom, setMaskZoom] = useState(1);
  const [maskPan, setMaskPan] = useState({ x: 0, y: 0 });
  const maskViewportRef = useRef<HTMLDivElement | null>(null);
  const maskContentRef = useRef<HTMLDivElement | null>(null);
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pinchRef = useRef<{
    distance: number;
    cx: number;
    cy: number;
    zoom: number;
    pan: { x: number; y: number };
  } | null>(null);
  const zoomPanRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  zoomPanRef.current = { zoom: maskZoom, pan: maskPan };

  // Clamp the pan so some part of the canvas always stays on screen.
  const clampPan = useCallback(
    (pan: { x: number; y: number }, zoom: number) => {
      const viewport = maskViewportRef.current;
      const content = maskContentRef.current;
      if (!viewport || !content) return pan;
      const slackX = viewport.clientWidth - content.offsetWidth * zoom;
      const slackY = viewport.clientHeight - content.offsetHeight * zoom;
      return {
        x: Math.min(Math.max(pan.x, Math.min(0, slackX)), Math.max(0, slackX)),
        y: Math.min(Math.max(pan.y, Math.min(0, slackY)), Math.max(0, slackY)),
      };
    },
    []
  );

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const viewport = maskViewportRef.current;
      if (!viewport) return;
      const prev = zoomPanRef.current;
      const next = Math.min(Math.max(prev.zoom * factor, MIN_MASK_ZOOM), MAX_MASK_ZOOM);
      if (next === prev.zoom) return;
      const rect = viewport.getBoundingClientRect();
      const cx = clientX - rect.left;
      const cy = clientY - rect.top;
      // Keep the content point under the cursor fixed while the zoom changes.
      const pan = clampPan(
        {
          x: cx - ((cx - prev.pan.x) / prev.zoom) * next,
          y: cy - ((cy - prev.pan.y) / prev.zoom) * next,
        },
        next
      );
      setMaskZoom(next);
      setMaskPan(pan);
    },
    [clampPan]
  );

  const resetMaskZoom = useCallback(() => {
    setMaskZoom(1);
    setMaskPan({ x: 0, y: 0 });
  }, []);

  // React registers wheel/touch listeners as passive at the root, so the
  // zoom handlers attach natively with passive: false to allow
  // preventDefault (stops the page scrolling while zooming the canvas).
  useEffect(() => {
    const viewport = maskViewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Exponential factor: smooth on trackpads (small deltas) and mice.
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(e.clientX, e.clientY, factor);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      pinchRef.current = {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        cx: (a.clientX + b.clientX) / 2,
        cy: (a.clientY + b.clientY) / 2,
        zoom: zoomPanRef.current.zoom,
        pan: { ...zoomPanRef.current.pan },
      };
    };
    const onTouchMove = (e: TouchEvent) => {
      const start = pinchRef.current;
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const cx = (a.clientX + b.clientX) / 2;
      const cy = (a.clientY + b.clientY) / 2;
      zoomAt(cx, cy, distance / start.distance);
    };
    const onTouchEnd = () => {
      pinchRef.current = null;
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("touchstart", onTouchStart, { passive: false });
    viewport.addEventListener("touchmove", onTouchMove, { passive: false });
    viewport.addEventListener("touchend", onTouchEnd);
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("touchend", onTouchEnd);
    };
  }, [zoomAt]);

  // Middle-mouse drag pans the canvas without painting a stroke. Space+drag
  // is NOT implemented: Space is the existing paint-toggle shortcut (issues
  // #378/#691, pinned by tests and the aria label), so arming pan on Space
  // would also start a stroke — that rebinding is a separate decision.
  const handlePanMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const prev = zoomPanRef.current;
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: prev.pan.x,
        originY: prev.pan.y,
      };
    },
    []
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = panDragRef.current;
      if (!drag) return;
      const viewport = maskViewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const scale =
        rect.width > 0 ? viewport.clientWidth / rect.width || 1 : 1;
      setMaskPan(
        clampPan(
          {
            x: drag.originX + (e.clientX - drag.startX) * scale,
            y: drag.originY + (e.clientY - drag.startY) * scale,
          },
          zoomPanRef.current.zoom
        )
      );
    };
    const onUp = () => {
      panDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [clampPan]);

  // The interactive stage (overlay canvas + mask canvas + cursor +
  // badges + empty-state hint) lives in mask-canvas-stage.tsx (#691).
  const canvasElement = (
    <MaskCanvasStage
      canvasRef={canvasRef}
      overlayCanvasRef={overlayCanvasRef}
      dims={dims}
      backing={backing}
      hasOverlay={hasOverlay}
      activeTool={activeTool}
      cursorClass={cursorClass}
      canvasAriaLabel={canvasAriaLabel}
      maskingHintId={maskingHintId}
      hintId={hintId}
      handleStart={handleStart}
      handleMove={handleMove}
      handleEnd={handleEnd}
      handleCanvasKeyDown={handleCanvasKeyDown}
      handleCanvasFocus={handleCanvasFocus}
      handleCanvasBlur={handleCanvasBlur}
      isCanvasFocused={isCanvasFocused}
      isKeyboardPainting={isKeyboardPainting}
      cursor={cursor}
      brushSize={brushSize}
      selectionMarkers={selectionMarkers}
      markerSpace={markerSpace}
      onSelectionDeselect={onSelectionDeselect}
      hasPainted={hasPainted}
      segmenting={segmenting}
      detectingConcept={detectingConcept}
      instanceOverlays={instanceOverlays}
    />
  );

  return (
    <div
      className={
        fullWidth
          ? "flex w-full flex-col gap-4"
          : "flex w-fit max-w-full flex-col gap-4"
      }
    >
      {/* Issue #1223: the zoom/pan viewport. The transform lives on the
          inner wrapper (content), never the mask buffer. Middle-drag pans;
          wheel/pinch zoom toward the cursor. */}
      {/* Middle-button pan only; the viewport is not a focusable control,
          so it deliberately stays outside the tab order. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        ref={maskViewportRef}
        className={hasOverlay ? "relative overflow-hidden" : "relative"}
        onMouseDown={handlePanMouseDown}
      >
      <div ref={maskContentRef}>
      {hasOverlay ? (
        <div
          ref={photoStackRef}
          className={
            fullWidth
              ? // Issue #265: raise min-height from 192px (min-h-48) to 180px
                // so the canvas stays usable on 1280x720 laptops. The aspect
                // ratio box grows to fill available height; this is the floor.
                "relative w-full min-h-[180px]"
              : "relative w-full max-w-md min-h-48"
          }
          style={
            aspectRatio && aspectRatio > 0
              ? {
                  aspectRatio: `${dims.width} / ${dims.height}`,
                  ...(fitWidth !== null ? { width: `${fitWidth}px` } : {}),
                }
              : undefined
          }
        >
          {/* The mask paints over the exact intrinsic image, so the editor
              needs a plain <img> (sometimes with no src); next/image's
              optimizer and wrapper would change the request path and DOM
              in this pixel-stacked surface. The LCP heuristic behind
              no-img-element does not apply here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={overlayImageSrc || undefined}
            alt="Original"
            className="absolute inset-0 h-full w-full rounded-lg border border-atelier-taupe/40"
            loading="lazy"
            decoding="async"
          />
          {/* Issue #641: pulsing ring around canvas border when inpaint request is processing */}
          {processing && (
            <div className="absolute inset-0 rounded-lg border-2 border-secondary/50 stage-pulse pointer-events-none" aria-hidden="true" />
          )}
          {canvasElement}
        </div>
      ) : (
        <div className="relative w-fit">{canvasElement}</div>
      )}
      </div>
      </div>

      {/* Cover-vs-outline semantics: the mask is region replacement, not
          selection — everything painted is regenerated. */}
      <p ref={hintRef} id={maskingHintId} className="text-xs text-atelier-primary">
        <span className="font-medium">How masking works:</span> Paint over the
        entire object or area you want changed — everything painted is
        regenerated, everything else is preserved. A thin outline won&apos;t
        change the interior, so cover the whole object (or draw an outline and
        use Fill Region on its inside).
        {" Select Regions detects every instance of the chosen concept in one call — pick a concept chip above, then click outlined instances to add them to the mask (outlines turn solid fills when selected). Nearby instances fuse into one region. Re-clicks and re-toggles are free."}
      </p>

      {lowCoverage && (
        <p role="status" className="text-xs font-medium text-amber-700">
          The painted area is very small — this may be a stray stroke or just
          an outline. Paint over the entire object you want changed, then apply
          inpainting.
        </p>
      )}

      {/* Issue #560: hint and legend hidden in Zen Mode */}
      {!zenMode && (
        <p id={hintId} className="text-xs text-atelier-taupe">
          Tab to the canvas to paint. Press <button
            type="button"
            onClick={() => setShowLegend(true)}
            className="mx-0.5 rounded border border-atelier-taupe/40 bg-white px-1 py-0.5 text-xs font-medium hover:bg-atelier-canvas"
          >?</button> for keyboard shortcuts.
        </p>
      )}

      {!zenMode && (
        <MaskCanvasToolbar
          activeTool={activeTool}
          onSelectTool={(tool) => {
            if (onActiveToolChange) {
              onActiveToolChange(tool);
            } else {
              setInternalActiveTool(tool);
            }
          }}
          segmenting={segmenting}
          segmentDisabled={segmentDisabled}
          onSelectRegionsActivate={onSelectRegionsActivate}
          brushSize={brushSize}
          onBrushSizeChange={(next) => {
            if (onBrushSizeChange) {
              onBrushSizeChange(next);
            } else {
              setInternalBrushSize(next);
            }
          }}
          onClearMask={clearMask}
          canUndo={canUndo}
          undoCount={undoCount}
          onUndo={handleUndo}
          canRedo={canRedo}
          redoCount={redoCount}
          onRedo={handleRedo}
          zoom={maskZoom}
          onResetZoom={resetMaskZoom}
          showLegend={showLegend}
          onToggleLegend={() => setShowLegend((prev) => !prev)}
        />
      )}

      <input type="hidden" value={maskDataUrl ?? ""} />
    </div>
  );
}

export function useMaskState() {
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  return { maskDataUrl, setMaskDataUrl };
}
