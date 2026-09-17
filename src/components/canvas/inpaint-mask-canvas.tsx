"use client";

import { useRef, useState, useEffect, useCallback, useMemo, useId } from "react";
import {
  canvasPointToNatural,
  clientPointToCanvas,
  computeBackingStoreDimensions,
  computeMaskCanvasDimensions,
  logicalPointToBackingStore,
  type CanvasPoint,
} from "@/lib/canvas-coords";
import { estimateMaskCoverage, shouldWarnLowCoverage } from "@/lib/mask-coverage";
import { floodFillMask, maskGridFromPixels, mergeMaskGrids } from "@/lib/mask-flood-fill";

/** Tools for building the mask: freehand paint, flood-fill, or click-to-segment. */
type MaskTool = "brush" | "fill" | "select";

/**
 * A completed click-to-segment response to paint onto the mask (issue
 * #183). `id` must change per request so each successful response applies
 * exactly once; `maskDataUrl` is a white-on-black PNG data URL.
 */
export interface SegmentMaskRequest {
  id: number;
  maskDataUrl: string;
}

interface InpaintMaskCanvasProps {
  width?: number;
  height?: number;
  brushSize?: number;
  initialMaskDataUrl?: string | null;
  onMaskChange?: (maskDataUrl: string | null) => void;
  /** Natural aspect ratio (width / height) of the source photo; sizes the mask canvas to match it. */
  aspectRatio?: number | null;
  /** Natural pixel width of the uploaded photo; exported masks are scaled to match. */
  naturalWidth?: number | null;
  /** Natural pixel height of the uploaded photo. */
  naturalHeight?: number | null;
  /** Photo rendered underneath the mask so the canvas overlays it exactly. */
  overlayImageSrc?: string | null;
  /**
   * Full-width focused layout (issue #169): the photo + mask span the
   * available content width instead of the compact card cap (`max-w-md`).
   */
  fullWidth?: boolean;
  /**
   * Select Object tool (issue #183): called on click with the point in the
   * photo's natural pixel space. The parent issues the /api/segment call.
   */
  onSegmentSelect?: (point: CanvasPoint) => void;
  /** True while segmenting (or inpainting) runs; select clicks are ignored. */
  segmentDisabled?: boolean;
  /** A successful segment response to merge onto the active mask grid. */
  segmentMaskRequest?: SegmentMaskRequest | null;
}

export default function InpaintMaskCanvas({
  width = 512,
  height = 512,
  brushSize: initialBrushSize = 20,
  initialMaskDataUrl,
  onMaskChange,
  aspectRatio,
  naturalWidth,
  naturalHeight,
  overlayImageSrc,
  fullWidth = false,
  onSegmentSelect,
  segmentDisabled = false,
  segmentMaskRequest = null,
}: InpaintMaskCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(initialBrushSize);
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(initialMaskDataUrl ?? null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Cost guardrail for the paid SAM call (issue #183): a repeat click on
  // the exact same point is deduped (the endpoint is deterministic, so the
  // identical point would return an identical mask). Any manual paint,
  // clear, or geometry change resets the key so re-selection stays
  // possible.
  const lastSegmentPointRef = useRef<CanvasPoint | null>(null);

  // Masking-guidance state: which tool is active, whether anything has been
  // painted yet (drives the empty-state hint), and whether the exported mask
  // is suspiciously tiny (drives the low-coverage warning).
  const [activeTool, setActiveTool] = useState<MaskTool>("brush");
  const [hasPainted, setHasPainted] = useState(false);
  const [lowCoverage, setLowCoverage] = useState(false);

  // Keyboard painting: the virtual brush cursor lives in canvas pixel space
  // (the same space clientPointToCanvas produces) so arrow-key deltas scale
  // with the canvas resolution, not with client pixels.
  const [isCanvasFocused, setIsCanvasFocused] = useState(false);
  const [isKeyboardPainting, setIsKeyboardPainting] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const keyboardPaintingRef = useRef(false);
  const hintId = useId();
  const maskingHintId = useId();

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

  const backing = useMemo(
    () => computeBackingStoreDimensions(dims.width, dims.height, devicePixelRatio),
    [dims.width, dims.height, devicePixelRatio]
  );

  const hasOverlay = Boolean(overlayImageSrc);

  // Latest initial mask without making initCanvas depend on it — re-running
  // init on every parent render would wipe in-progress strokes.
  const initialMaskRef = useRef(initialMaskDataUrl);
  useEffect(() => {
    initialMaskRef.current = initialMaskDataUrl;
  }, [initialMaskDataUrl]);

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
    lastSegmentPointRef.current = null;
  }, [dims.width, dims.height, backing]);

  // Initialize once on mount, and re-initialize when the geometry changes
  // (e.g. the photo's aspect ratio resolves after the image loads) or when
  // the underlying photo itself changes (issue #170 source switching) — a
  // mask drawn for one image must never survive onto the next. The ref sync
  // effect above runs first, so initCanvas reads the latest initial mask.
  useEffect(() => {
    initCanvas();
  }, [initCanvas, overlayImageSrc]);

  const getCoordinates = (
    e: React.MouseEvent | React.TouchEvent
  ): { x: number; y: number } | null => {
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
  };

  const draw = (
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) => {
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
  };

  // A zero-length stroked line renders inconsistently across browsers, so
  // single-point paints (keyboard toggle-down, no movement yet) fill a disc.
  const drawDot = (at: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(at.x, at.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  // Fill Region tool: flood-fills the unpainted region connected to the
  // click/cursor point with painted pixels. Designed for cover-the-object
  // semantics — draw a continuous outline around the object, then fill its
  // interior in one click instead of painting it by hand. Returns true when
  // pixels changed.
  const performFill = (point: { x: number; y: number }): boolean => {
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
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const point = getCoordinates(e);
    if (!point) return;
    if (activeTool === "select") {
      handleSegmentClick(point);
      return;
    }
    if (activeTool === "fill") {
      lastSegmentPointRef.current = null;
      if (performFill(point)) {
        setHasPainted(true);
        exportMask();
      }
      return;
    }
    lastSegmentPointRef.current = null;
    setIsDrawing(true);
    lastPointRef.current = point;
    setHasPainted(true);
    draw(point, point);
  };

  // Select Object tool: converts the clicked canvas point into the photo's
  // natural pixel space (what the SAM point prompt expects), dedupes repeat
  // clicks on the same point, and hands off to the parent's /api/segment
  // call. The canvas is only repainted when the parent comes back with a
  // successful response (via segmentMaskRequest), so failures leave it
  // untouched.
  const handleSegmentClick = (canvasPoint: CanvasPoint) => {
    if (!onSegmentSelect || segmentDisabled) return;
    const naturalWidthValue = naturalWidth && naturalWidth > 0 ? naturalWidth : dims.width;
    const naturalHeightValue = naturalHeight && naturalHeight > 0 ? naturalHeight : dims.height;
    const point = canvasPointToNatural(
      canvasPoint,
      dims.width,
      dims.height,
      naturalWidthValue,
      naturalHeightValue
    );
    const last = lastSegmentPointRef.current;
    if (last && last.x === point.x && last.y === point.y) return;
    lastSegmentPointRef.current = point;
    onSegmentSelect(point);
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing || !lastPointRef.current) return;
    const point = getCoordinates(e);
    if (!point) return;
    draw(lastPointRef.current, point);
    lastPointRef.current = point;
  };

  const handleEnd = () => {
    if (isDrawing) {
      setIsDrawing(false);
      lastPointRef.current = null;
      exportMask();
    }
  };

  const exportMask = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // fal-ai/flux-fill expects the mask geometry to match the source image,
    // so rescale the painted mask to the photo's natural pixel dimensions.
    const exportWidth =
      naturalWidth && naturalWidth > 0 ? Math.max(1, Math.round(naturalWidth)) : canvas.width;
    const exportHeight =
      naturalHeight && naturalHeight > 0 ? Math.max(1, Math.round(naturalHeight)) : canvas.height;

    let dataUrl: string;
    if (exportWidth === canvas.width && exportHeight === canvas.height) {
      dataUrl = canvas.toDataURL("image/png");
    } else {
      const scaled = document.createElement("canvas");
      scaled.width = exportWidth;
      scaled.height = exportHeight;
      const scaledCtx = scaled.getContext("2d");
      if (!scaledCtx) return;
      scaledCtx.drawImage(canvas, 0, 0, exportWidth, exportHeight);
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
  }, [naturalWidth, naturalHeight, onMaskChange]);

  const clearMask = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, dims.width, dims.height);
    setMaskDataUrl(null);
    setHasPainted(false);
    setLowCoverage(false);
    lastSegmentPointRef.current = null;
    onMaskChange?.(null);
  };

  // Applies a successful segment response: draws the returned white-on-black
  // mask at canvas resolution, OR-merges it onto the existing painted grid
  // (manual strokes survive), and re-exports. Failure paths (parent never
  // sends a request, image load error) leave the canvas pixels untouched.
  useEffect(() => {
    if (!segmentMaskRequest) return;
    let cancelled = false;
    const applySegmentMask = (img: HTMLImageElement) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const base = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const segment = document.createElement("canvas");
      segment.width = canvas.width;
      segment.height = canvas.height;
      const segmentCtx = segment.getContext("2d");
      if (!segmentCtx) return;
      segmentCtx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const segmentData = segmentCtx.getImageData(0, 0, canvas.width, canvas.height);

      const merged = mergeMaskGrids(
        maskGridFromPixels(base.data, canvas.width, canvas.height),
        maskGridFromPixels(segmentData.data, canvas.width, canvas.height)
      );
      if (!merged) return;

      const data = base.data;
      for (let i = 0; i < merged.mask.length; i++) {
        if (merged.mask[i] === 1) {
          const o = i * 4;
          data[o] = 255;
          data[o + 1] = 255;
          data[o + 2] = 255;
          data[o + 3] = 255;
        }
      }
      ctx.putImageData(base, 0, 0);
      setHasPainted(true);
      exportMask();
    };

    const img = new Image();
    img.onload = () => {
      if (!cancelled) applySegmentMask(img);
    };
    img.src = segmentMaskRequest.maskDataUrl;
    return () => {
      cancelled = true;
    };
  }, [segmentMaskRequest, exportMask]);

  // The virtual brush cursor lives in LOGICAL canvas space — the same
  // space clientPointToCanvas produces and the DOM cursor indicator
  // positions against (issue #181 keeps it DPR-independent).
  const centerOf = () => ({
    x: dims.width / 2,
    y: dims.height / 2,
  });

  const moveCursorTo = (next: { x: number; y: number }) => {
    const point = {
      x: Math.min(Math.max(next.x, 0), dims.width),
      y: Math.min(Math.max(next.y, 0), dims.height),
    };
    if (keyboardPaintingRef.current) {
      const from = cursorRef.current ?? point;
      draw(from, point);
    }
    cursorRef.current = point;
    setCursor(point);
  };

  const liftKeyboardPaint = () => {
    if (!keyboardPaintingRef.current) return;
    keyboardPaintingRef.current = false;
    setIsKeyboardPainting(false);
    exportMask();
  };

  const toggleKeyboardPaint = () => {
    if (!canvasRef.current) return;
    if (activeTool === "select") {
      const at = cursorRef.current ?? centerOf();
      cursorRef.current = at;
      setCursor(at);
      handleSegmentClick(at);
      return;
    }
    if (activeTool === "fill") {
      const at = cursorRef.current ?? centerOf();
      cursorRef.current = at;
      setCursor(at);
      lastSegmentPointRef.current = null;
      if (performFill(at)) {
        setHasPainted(true);
        exportMask();
      }
      return;
    }
    lastSegmentPointRef.current = null;
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
  };

  const ARROW_DELTAS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
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
    }
  };

  const handleCanvasFocus = () => {
    setIsCanvasFocused(true);
    const canvas = canvasRef.current;
    if (canvas && !cursorRef.current) {
      const at = centerOf();
      cursorRef.current = at;
      setCursor(at);
    }
  };

  const handleCanvasBlur = () => {
    setIsCanvasFocused(false);
    liftKeyboardPaint();
  };

  // Brush cursor indicator is a DOM overlay, never canvas pixels, so the
  // exported mask stays clean. Positioned/sized as percentages of the canvas
  // box so it matches the display size in both overlay and standalone modes.
  const cursorIndicator =
    isCanvasFocused && cursor ? (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute z-10 rounded-full border-2 border-white ${
          isKeyboardPainting ? "bg-white/40" : ""
        }`}
        style={{
          left: `${(cursor.x / dims.width) * 100}%`,
          top: `${(cursor.y / dims.height) * 100}%`,
          width: `${(brushSize / dims.width) * 100}%`,
          height: `${(brushSize / dims.height) * 100}%`,
          transform: "translate(-50%, -50%)",
          boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.6)",
        }}
      />
    ) : null;

  const cursorClass = activeTool === "fill" ? "cursor-cell" : "cursor-crosshair";

  const canvasAriaLabel =
    activeTool === "fill"
      ? "Room mask canvas with the Fill Region tool active: draw a continuous outline around the object, arrow keys move the cursor, press P, Space, or Enter to fill the region under the cursor"
      : activeTool === "select"
        ? "Room mask canvas with the Select Object tool active: click an object in the photo to paint its detected shape onto the mask, arrow keys move the cursor, press P, Space, or Enter to select the object under the cursor"
        : "Room mask painting canvas: arrow keys move the brush (hold Shift for fine steps), press P, Space, or Enter to start and stop painting";

  const canvasElement = (
    <div
      role="application"
      className={hasOverlay ? "absolute inset-0" : "relative w-fit"}
    >
      <canvas
        ref={canvasRef}
        width={backing.width}
        height={backing.height}
        tabIndex={0}
        aria-label={canvasAriaLabel}
        aria-describedby={`${maskingHintId} ${hintId}`}
        className={
          hasOverlay
            ? `absolute inset-0 h-full w-full rounded-lg ${cursorClass} touch-none opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-2`
            : `border border-gray-300 rounded ${cursorClass} touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-2`
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
            {activeTool === "select"
              ? "Click an object to select it for masking"
              : "Drag to paint over the object you want changed"}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={
        fullWidth
          ? "flex w-full flex-col gap-4"
          : "flex w-fit max-w-full flex-col gap-4"
      }
    >
      {hasOverlay ? (
        <div
          className={
            fullWidth
              ? "relative w-full min-h-48"
              : "relative w-full max-w-md min-h-48"
          }
          style={
            aspectRatio && aspectRatio > 0
              ? { aspectRatio: `${dims.width} / ${dims.height}` }
              : undefined
          }
        >
          <img
            src={overlayImageSrc || undefined}
            alt="Original"
            className="absolute inset-0 h-full w-full rounded-lg border border-gray-300"
            loading="lazy"
            decoding="async"
          />
          {canvasElement}
        </div>
      ) : (
        <div className="relative w-fit">{canvasElement}</div>
      )}

      {/* Cover-vs-outline semantics: the mask is region replacement, not
          selection — everything painted is regenerated. */}
      <p id={maskingHintId} className="text-xs text-stone-700">
        <span className="font-medium">How masking works:</span> Paint over the
        entire object or area you want changed — everything painted is
        regenerated, everything else is preserved. A thin outline won&apos;t
        change the interior, so cover the whole object (or draw an outline and
        use Fill Region on its inside). Select Object detects a clicked
        object&apos;s shape for you and paints it onto the mask.
      </p>

      {lowCoverage && (
        <p role="status" className="text-xs font-medium text-amber-700">
          The painted area is very small — this may be a stray stroke or just
          an outline. Paint over the entire object you want changed, then apply
          inpainting.
        </p>
      )}

      <p id={hintId} className="text-xs text-gray-500">
        Keyboard painting: Tab to the canvas, move the brush with the arrow keys
        (Shift + arrow for fine steps), and press P, Space, or Enter to start or
        stop painting. Brush Size and Clear Mask follow in the tab order.
      </p>

      <div className="flex items-center gap-4">
        <div role="group" aria-label="Mask tool" className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={activeTool === "brush"}
            onClick={() => setActiveTool("brush")}
            className={
              activeTool === "brush"
                ? "px-3 py-1.5 text-sm rounded-md border border-stone-800 bg-stone-800 text-white hover:bg-stone-700 transition-colors"
                : "px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
            }
          >
            Brush
          </button>
          <button
            type="button"
            aria-pressed={activeTool === "fill"}
            onClick={() => setActiveTool("fill")}
            className={
              activeTool === "fill"
                ? "px-3 py-1.5 text-sm rounded-md border border-stone-800 bg-stone-800 text-white hover:bg-stone-700 transition-colors"
                : "px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
            }
          >
            Fill Region
          </button>
          <button
            type="button"
            aria-pressed={activeTool === "select"}
            disabled={segmentDisabled}
            onClick={() => setActiveTool("select")}
            className={
              activeTool === "select"
                ? "px-3 py-1.5 text-sm rounded-md border border-stone-800 bg-stone-800 text-white hover:bg-stone-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                : "px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            }
          >
            Select Object
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm">
          Brush Size:
          <input
            type="range"
            min={1}
            max={100}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-32"
          />
          <span className="w-8 text-right">{brushSize}</span>
        </label>

        <button
          onClick={clearMask}
          className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
        >
          Clear Mask
        </button>
      </div>

      <input type="hidden" value={maskDataUrl ?? ""} />
    </div>
  );
}

export function useMaskState() {
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  return { maskDataUrl, setMaskDataUrl };
}
