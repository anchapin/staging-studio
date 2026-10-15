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

/**
 * Physical (device-pixel) backing-store size for a canvas laid out at the
 * given logical (CSS-pixel) dimensions under a device pixel ratio (issue
 * #181). The 2D context should be scaled by the same ratio so drawing can
 * stay in logical coordinates while strokes land on physical pixels.
 *
 * A non-finite or non-positive ratio falls back to 1 so SSR/pre-mount
 * rendering and hostile values never produce a zero-sized buffer.
 */
export function computeBackingStoreDimensions(
  width: number,
  height: number,
  devicePixelRatio: number
): CanvasDimensions {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Maps a point in logical canvas space to the physical backing-store pixel
 * that contains it: scaled by the device pixel ratio, floored to an integer
 * pixel index, and clamped inside the backing-store bounds (so the result
 * is always a safe grid/seed index for flood fill, issue #181).
 */
export function logicalPointToBackingStore(
  point: CanvasPoint,
  devicePixelRatio: number,
  backing: CanvasDimensions
): CanvasPoint {
  const ratio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    x: clamp(Math.floor(point.x * ratio), 0, Math.max(0, backing.width - 1)),
    y: clamp(Math.floor(point.y * ratio), 0, Math.max(0, backing.height - 1)),
  };
}

/**
 * Maps a point in canvas pixel space to the source photo's natural pixel
 * space, rounding and clamping to the natural bounds.
 *
 * Purpose: SAM point prompts (issue #183) are expressed in the image's
 * natural pixels, while clicks arrive in the (lower-resolution) canvas
 * pixel space. Canvas and photo share an aspect ratio, so this is a
 * uniform per-axis scale.
 */
export function canvasPointToNatural(
  point: CanvasPoint,
  canvasWidth: number,
  canvasHeight: number,
  naturalWidth: number,
  naturalHeight: number
): CanvasPoint {
  const scaleX = canvasWidth > 0 ? naturalWidth / canvasWidth : 0;
  const scaleY = canvasHeight > 0 ? naturalHeight / canvasHeight : 0;

  return {
    x: clamp(Math.round(point.x * scaleX), 0, Math.max(0, naturalWidth)),
    y: clamp(Math.round(point.y * scaleY), 0, Math.max(0, naturalHeight)),
  };
}

/**
 * Percent-based detection box, the shape the segmentation / detection
 * surfaces emit (issue #228/#1339). Values are 0–100; the provider
 * (SAM, the inpaint provider's detection API, etc) is responsible for
 * keeping them in range, but this helper clamps defensively because
 * a hostile / future-type value must never produce a NaN string in the
 * inline CSS positioning (which would hide the on-canvas button).
 */
export interface ObjectBoundingBox {
  /** Top-left X as % of the image (0..100). */
  x: number;
  /** Top-left Y as % of the image (0..100). */
  y: number;
  /** Width as % of the image (0..100). */
  w: number;
  /** Height as % of the image (0..100). */
  h: number;
}

/** CSSProperties-style positioning for an on-canvas `<button>` overlay. */
export interface ObjectBoxStyle {
  left: string;
  top: string;
  width: string;
  height: string;
}

/**
 * Maps a percent-based detection box (`ObjectBoundingBox`) to the CSS
 * positioning the on-canvas `<button>` overlay uses (issue #1339).
 * Values are clamped so a defensive `-5` or `NaN` from a malformed
 * provider response collapses to `0%` instead of producing `"NaN%"`.
 *
 * Width/height are clamped to `[0, 100]` so a hostile value can never
 * paint a button larger than the canvas. X/Y are clamped to `[0, 100]`
 * for the same reason — a button whose top-left sits outside the photo
 * (e.g. x = -30%) would be unreachable on touch.
 */
export function objectBoxToStyle(box: ObjectBoundingBox): ObjectBoxStyle {
  const clamp100 = (n: number) =>
    Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  const clampNonNegative = (n: number) =>
    Number.isFinite(n) ? Math.max(0, n) : 0;
  return {
    left: `${clamp100(box.x)}%`,
    top: `${clamp100(box.y)}%`,
    width: `${clampNonNegative(box.w)}%`,
    height: `${clampNonNegative(box.h)}%`,
  };
}
