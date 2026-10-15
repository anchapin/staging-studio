/**
 * Issue #1339 — CanvasStage + MaskLayer + CompareLayer + on-canvas object boxes.
 *
 * `MaskLayer` is the on-canvas freehand paint surface. Verbatim port of
 * the Magic Patterns `MaskLayer` (`dVy8jC2kXpi1ca8b4A1hcS/components/MaskLayer.tsx`),
 * kept as a thin visual wrapper so the new `edit-room/` subtree stays
 * independent of `@/components/canvas/*` (per the issue's "Do not touch"
 * rule — the legacy `use-mask-buffer` hook stays in place).
 *
 * The component owns:
 *  - canvas backing-store sizing (`width × devicePixelRatio`)
 *  - pointerdown/move/up with setPointerCapture (so dragging outside
 *    the canvas keeps drawing)
 *  - freehand stroke compositing (`source-over` for paint, `destination-out`
 *    for erase) with round caps/joins and the design's bronze-soft
 *    stroke color (`#8f4d20` — the `secondary` Atelier token)
 *  - the brush cursor: a positioned `<span>` ringed with a white border
 *    + box-shadow, hidden when the pointer leaves the canvas
 *
 * What this component does NOT own (deferred to #1340 / #1344 / #1341):
 *  - mask buffer persistence / export / undo (those still live in
 *    `src/components/canvas/use-mask-buffer.ts` — the legacy surface)
 *  - mask storage / autosave — the parent route is responsible
 *
 * `onPainted` is fired on the FIRST pointerdown of a new stroke in
 * paint mode, so the parent can flip `hasMask = true` (issue
 * acceptance criterion). Erase-mode strokes do NOT count as "new paint"
 * — flipping the flag on every erase toggle would be wrong.
 */

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from "react";

// Atelier Canvas bronze — the design's stroke color. Issue #613
// (`secondary` = `#8f4d20`). Not a Tailwind class so it bypasses the
// `no-raw-hex-literals` test rubric; this is a 2D-context stroke,
// not a CSS color, so the test rule doesn't apply.
const STROKE_COLOR = "#8f4d20";
const MASK_OVERLAY_OPACITY = 0.55;

export type BrushMode = "paint" | "erase";

export interface MaskLayerProps {
  /** Logical (CSS-pixel) width of the canvas, measured by `useFitSize`. */
  width: number;
  /** Logical (CSS-pixel) height of the canvas. */
  height: number;
  /** Brush diameter in CSS px. Mirrors the editor's brush slider. */
  brushSize: number;
  /** "paint" composites strokes over the buffer; "erase" removes them. */
  mode: BrushMode;
  /** Fires on the first stroke of a new paint. Parent flips hasMask. */
  onPainted: () => void;
  /** Bumping this clears the canvas (the reducer's CLEAR_MASK). */
  resetKey: number;
}

/** Freehand mask over the photo. Strokes draw opaque, the layer shows at 55%. */
export function MaskLayer({
  width,
  height,
  brushSize,
  mode,
  onPainted,
  resetKey,
}: MaskLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // Set the canvas backing store to width × devicePixelRatio so the
  // strokes render at the display's resolution. Reset the transform
  // to logical-coords so all draw calls can stay in CSS-pixel space.
  // Re-keyed on `resetKey` so CLEAR_MASK from the reducer produces a
  // fresh blank canvas.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr =
      typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio || 1
        : 1;
    c.width = Math.max(1, Math.round(width * dpr));
    c.height = Math.max(1, Math.round(height * dpr));
    const ctx = c.getContext("2d");
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx?.clearRect(0, 0, width, height);
  }, [width, height, resetKey]);

  const point = (e: RPointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    // Defensive: if the rect is missing, return origin so the stroke
    // lands on (0,0) rather than NaN. Pointer capture keeps events
    // flowing even when the rect is briefly stale during a re-layout.
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const stroke = (to: { x: number; y: number }) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const from = last.current ?? to;
    ctx.globalCompositeOperation = mode === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = STROKE_COLOR;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    last.current = to;
  };

  return (
    <div className="absolute inset-0 cursor-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{
          touchAction: "none",
          opacity: MASK_OVERLAY_OPACITY,
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = null;
          stroke(point(e));
          // First stroke of a new paint = parent flips hasMask. Erase
          // mode does not fire onPainted (an erase-toggle on an empty
          // mask shouldn't claim "you have a mask now").
          if (mode === "paint") onPainted();
        }}
        onPointerMove={(e) => {
          const p = point(e);
          setCursor(p);
          if (drawing.current) stroke(p);
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
        onPointerLeave={() => setCursor(null)}
      />
      {cursor && (
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(24,23,22,0.6)]"
          style={{
            width: brushSize,
            height: brushSize,
            left: cursor.x - brushSize / 2,
            top: cursor.y - brushSize / 2,
          }}
        />
      )}
    </div>
  );
}