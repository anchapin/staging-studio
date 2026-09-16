export interface CanvasBoundingRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasDimensions {
  width: number;
  height: number;
}

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
