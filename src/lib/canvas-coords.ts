/** A DOM `getBoundingClientRect()`-style rect for the canvas element. */
export interface CanvasBoundingRect {
  /** Distance from the viewport's left edge to the canvas, CSS px. */
  left: number;
  /** Distance from the viewport's top edge to the canvas, CSS px. */
  top: number;
  /** Rendered CSS width of the canvas on screen. */
  width: number;
  /** Rendered CSS height of the canvas on screen. */
  height: number;
}

/** A point in canvas pixel space (0..canvasWidth, 0..canvasHeight). */
export interface CanvasPoint {
  /** X coordinate in canvas pixels, clamped to the canvas bounds. */
  x: number;
  /** Y coordinate in canvas pixels, clamped to the canvas bounds. */
  y: number;
}

/** Width/height pair in canvas pixels. */
export interface CanvasDimensions {
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
}

/**
 * Cap for the mask canvas's longer edge, in pixels. Keeps fal.ai FLUX.1
 * Fill mask payloads within the model's supported resolution.
 */
export const MAX_MASK_CANVAS_LONG_EDGE = 1024;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Maps a client (viewport) point into canvas pixel space, accounting for the
 * CSS display size of the canvas and clamping to the canvas bounds.
 */
export function clientPointToCanvas(
  clientX: number,
  clientY: number,
  rect: CanvasBoundingRect,
  canvasWidth: number,
  canvasHeight: number
): CanvasPoint {
  const scaleX = rect.width > 0 ? canvasWidth / rect.width : 0;
  const scaleY = rect.height > 0 ? canvasHeight / rect.height : 0;

  return {
    x: clamp((clientX - rect.left) * scaleX, 0, canvasWidth),
    y: clamp((clientY - rect.top) * scaleY, 0, canvasHeight),
  };
}

/**
 * Sizes a mask canvas to a source image's aspect ratio, capped at
 * `maxLongEdge` pixels on the long edge. Falls back to a square for invalid
 * aspect ratios.
 */
export function computeMaskCanvasDimensions(
  aspectRatio: number,
  maxLongEdge: number = MAX_MASK_CANVAS_LONG_EDGE
): CanvasDimensions {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return { width: maxLongEdge, height: maxLongEdge };
  }

  if (aspectRatio >= 1) {
    return {
      width: maxLongEdge,
      height: Math.max(1, Math.round(maxLongEdge / aspectRatio)),
    };
  }

  return {
    width: Math.max(1, Math.round(maxLongEdge * aspectRatio)),
    height: maxLongEdge,
  };
}
