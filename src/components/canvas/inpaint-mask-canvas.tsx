"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { clientPointToCanvas, computeMaskCanvasDimensions } from "@/lib/canvas-coords";

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
}: InpaintMaskCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(initialBrushSize);
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(initialMaskDataUrl ?? null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

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
  }, [dims.width, dims.height]);

  // Initialize once on mount, and re-initialize when the geometry changes
  // (e.g. the photo's aspect ratio resolves after the image loads).
  useEffect(() => {
    initCanvas();
  }, [initCanvas]);

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

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const point = getCoordinates(e);
    if (!point) return;
    setIsDrawing(true);
    lastPointRef.current = point;
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
  }, [naturalWidth, naturalHeight, onMaskChange]);

  const clearMask = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, dims.width, dims.height);
    setMaskDataUrl(null);
    onMaskChange?.(null);
  };

  const canvasElement = (
    <canvas
      ref={canvasRef}
      width={dims.width}
      height={dims.height}
      className={
        hasOverlay
          ? "absolute inset-0 h-full w-full rounded-lg cursor-crosshair touch-none opacity-60"
          : "border border-gray-300 rounded cursor-crosshair touch-none"
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
    />
  );

  return (
    <div className="flex flex-col gap-4 w-fit max-w-full">
      {hasOverlay ? (
        <div
          className="relative w-full max-w-md min-h-48"
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
          />
          {canvasElement}
        </div>
      ) : (
        canvasElement
      )}

      <div className="flex items-center gap-4">
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
