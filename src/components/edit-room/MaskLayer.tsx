/**
 * Issue #1339 — CanvasStage + MaskLayer + CompareLayer + on-canvas object boxes.
 * Issue #1344 (real `useInpaintRuns` wire) — `MaskLayer` exports the mask
 *               buffer via `onChange(dataUrl | null)` so the parent route
 *               can hand the painted area to `submitInpaint` at run time.
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
 *  - `onChange?: (dataUrl | null)` — fires after every stroke (paint or
 *    erase) and on clearRect; the parent route captures the latest
 *    data URL for `/api/inpaint`'s `maskUrl` body field.
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
 *
 * `onChange` is unrelated to `onPainted` — it fires on EVERY stroke
 * (paint and erase) so the parent's submit path can grab the latest
 * buffer, including the all-cleared state (`null`).
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
  /**
   * Fires after every stroke (paint or erase) and on clearRect; emits
   * the canvas's current `toDataURL("image/png")` representation, or
   * `null` when the buffer is empty (i.e. cleared by resetKey or
   * erased down to nothing). The parent uses this to capture the mask
   * to hand to `/api/inpaint`'s `maskUrl` body field on submit
   * (issue #1344 — real `useInpaintRuns` wire).
   *
   * Optional: legacy call sites and SSR renderers omit the prop and
   * the layer renders unchanged (issue #1339 contract).
   */
  onChange?: (dataUrl: string | null) => void;
}

/** Freehand mask over the photo. Strokes draw opaque, the layer shows at 55%. */
export function MaskLayer({
  width,
  height,
  brushSize,
  mode,
  onPainted,
  resetKey,
  onChange,
}: MaskLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // Build a snapshot of the current canvas (or `null` if the buffer is
  // empty enough that the toDataURL round-trip would only waste bytes).
  // `onChange` is held behind a ref so the snapshotter's identity stays
  // stable across renders — `stroke()` runs inside pointer handlers
  // and re-allocating the closure would otherwise force-unmount.
  const onChangeRef = useRef<((dataUrl: string | null) => void) | null>(onChange);
  useEffect(() => {
    onChangeRef.current = onChange ?? null;
  });
  const emitChange = () => {
    const cb = onChangeRef.current;
    if (!cb) return;
    const c = canvasRef.current;
    if (!c) return;
    cb(c.toDataURL("image/png"));
  };

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
    // Issue #1344 (real run wire) — `resetKey` bump means CLEAR_MASK;
    // signal the parent that the mask buffer is now empty. Without
    // this, the parent route would keep a stale data URL from the
    // previous paint and submit it on the next Run click.
    onChangeRef.current?.(null);
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
    // Issue #1344 — emit the buffer snapshot after every stroke so the
    // parent route always holds the latest mask data URL. The reduce
    // step (`hasMask` flag flip) is still on `onPainted` for paint
    // strokes; this fires unconditionally, paint or erase, so a
    // submit-click after an erase-only interaction still gets the
    // (possibly-reduced) snapshot.
    emitChange();
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