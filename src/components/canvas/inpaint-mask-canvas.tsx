"use client";

import { useRef, useState, useEffect, useCallback, useMemo, useId } from "react";
import { clientPointToCanvas, computeMaskCanvasDimensions } from "@/lib/canvas-coords";
import { estimateMaskCoverage, shouldWarnLowCoverage } from "@/lib/mask-coverage";
import { floodFillMask, maskGridFromPixels } from "@/lib/mask-flood-fill";

/** Tools for building the mask: freehand paint or flood-fill inside an outline. */
type MaskTool = "brush" | "fill";

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
}: InpaintMaskCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(initialBrushSize);
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(initialMaskDataUrl ?? null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

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
  }, [dims.width, dims.height]);

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

    if ("touches" in e) {
      const touch = e.touches[0];
      if (!touch) return null;
      return clientPointToCanvas(touch.clientX, touch.clientY, rect, canvas.width, canvas.height);
    }

    return clientPointToCanvas(e.clientX, e.clientY, rect, canvas.width, canvas.height);
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

    const seedX = Math.min(canvas.width - 1, Math.max(0, Math.floor(point.x)));
    const seedY = Math.min(canvas.height - 1, Math.max(0, Math.floor(point.y)));

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const grid = maskGridFromPixels(imageData.data, canvas.width, canvas.height);
    const result = floodFillMask(grid, canvas.width, canvas.height, seedX, seedY);
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
    if (activeTool === "fill") {
      if (performFill(point)) {
        setHasPainted(true);
        exportMask();
      }
      return;
    }
    setIsDrawing(true);
    lastPointRef.current = point;
    setHasPainted(true);
    draw(point, point);
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
    onMaskChange?.(null);
  };

  const centerOf = (canvas: HTMLCanvasElement) => ({
    x: canvas.width / 2,
    y: canvas.height / 2,
  });

  const moveCursorTo = (next: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = {
      x: Math.min(Math.max(next.x, 0), canvas.width),
      y: Math.min(Math.max(next.y, 0), canvas.height),
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (activeTool === "fill") {
      const at = cursorRef.current ?? centerOf(canvas);
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
    const at = cursorRef.current ?? centerOf(canvas);
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
    const canvas = canvasRef.current;
    if (!canvas) return;

    const delta = ARROW_DELTAS[e.key];
    if (delta) {
      e.preventDefault();
      const fraction = e.shiftKey ? 0.01 : 0.05;
      const current = cursorRef.current ?? centerOf(canvas);
      moveCursorTo({
        x: current.x + delta[0] * canvas.width * fraction,
        y: current.y + delta[1] * canvas.height * fraction,
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
      const at = centerOf(canvas);
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
      : "Room mask painting canvas: arrow keys move the brush (hold Shift for fine steps), press P, Space, or Enter to start and stop painting";

  const canvasElement = (
    <div
      role="application"
      className={hasOverlay ? "absolute inset-0" : "relative w-fit"}
    >
      <canvas
        ref={canvasRef}
        width={dims.width}
        height={dims.height}
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
            Drag to paint over the object you want changed
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
        use Fill Region on its inside).
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
