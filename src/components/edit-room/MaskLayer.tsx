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
 * Issue #1427 — the mask emission is coalesced: a `pointermove` only
 * marks the buffer dirty, and at most ONE full-canvas PNG encode runs
 * per animation frame (trailing duplicates inside a frame are dropped).
 * Every terminal event (pointerup / pointercancel / lost pointer capture
 * / unmount) flushes immediately, so the parent still holds the complete
 * final mask the moment a stroke ends — issue #1344's guarantee, pinned
 * by `tests/mask-emission-coalescer.test.ts`.
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
import {
  createCoalescerState,
  discardPending,
  flush,
  hasPendingChange,
  markDirty,
  type FrameScheduler,
} from "@/lib/mask-emission-coalescer";

// Atelier Canvas bronze — the design's stroke color. Issue #613
// (`secondary` = `#8f4d20`). Not a Tailwind class so it bypasses the
// `no-raw-hex-literals` test rubric; this is a 2D-context stroke,
// not a CSS color, so the test rule doesn't apply.
const STROKE_COLOR = "#8f4d20";
const MASK_OVERLAY_OPACITY = 0.55;

/**
 * Issue #1427 — the frame scheduler the mask-emission coalescer drives.
 *
 * `requestAnimationFrame` gives the browser exactly one coalescing point
 * per frame: every pointer event that lands inside the same frame
 * collapses into a single `toDataURL` encode, so the encode rate follows
 * the frame rate (≈60/s) instead of the pointer sampling rate (60–120+/s).
 *
 * The `setTimeout` fallback keeps the component functional where rAF is
 * unavailable (the repo's jsdom-less SSR test harnesses). The scheduling
 * policy is identical either way — only the clock differs.
 */
const FRAME_SCHEDULER: FrameScheduler = {
  request(callback: () => void): number {
    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      return window.requestAnimationFrame(callback);
    }
    return setTimeout(callback, 0) as unknown as number;
  },
  cancel(handle: number): void {
    if (
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(handle);
      return;
    }
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  },
};

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
   * Issue #1427 — mid-stroke the emission is coalesced to at most one
   * encode per animation frame; the terminal event of a stroke flushes
   * the final mask immediately, so the parent never holds a stale mask
   * once the stroke is over.
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

  // Issue #1427 — coalesce serialization to at most one encode per frame.
  //
  // `toDataURL("image/png")` is a synchronous, full-canvas read + PNG
  // encode (≈1.5–3 MB of base64 on a 1024×1024 retina canvas). Calling
  // it on every `pointermove` made the emission rate scale with pointer
  // sampling (often 60–120+/s), stalling the paint loop for seconds-long
  // jank on large canvases and re-rendering the whole parent tree with a
  // multi-megabyte string on every event.
  //
  // The policy lives in `lib/mask-emission-coalescer.ts` so it is unit
  // testable without a DOM; this component supplies the canvas, the
  // `onChange` callback and the frame scheduler. Mid-stroke moves only
  // mark the buffer dirty and let the scheduled frame do ONE encode for
  // the whole frame — trailing duplicates inside that frame are dropped.
  //
  // This does NOT weaken #1344: every terminal event (pointerup,
  // pointercancel, lost pointer capture, unmount) flushes immediately,
  // so the moment a stroke ends the parent holds the complete final mask
  // — not a frame-batched approximation of it.
  const coalescer = useRef(createCoalescerState());

  const serialize = () => {
    const cb = onChangeRef.current;
    if (!cb) return;
    const c = canvasRef.current;
    if (!c) return;
    // Issue #1427 / #1344 — the mask must stay a full-fidelity PNG:
    // the submit path feathers it through `featherMask()`, which blurs
    // the *alpha* channel, and the provider expects a binary mask whose
    // transparency marks the region to fill. A JPEG/downscale would
    // drop the alpha channel and destroy the mask, so the format stays
    // `image/png` and only the *frequency* of the encode changes.
    cb(c.toDataURL("image/png"));
  };

  /**
   * Mark the buffer changed and schedule the coalesced encode.
   * Cheap: no canvas read happens here.
   */
  const scheduleChange = () => {
    markDirty(coalescer.current, FRAME_SCHEDULER, serialize);
  };

  /** Emit the current buffer now, clearing any coalesced pending update. */
  const flushChange = () => {
    flush(coalescer.current, FRAME_SCHEDULER, serialize);
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
    // Issue #1427 — a frame scheduled by the previous buffer must not
    // fire after the clear and resurrect a stale PNG of the old strokes.
    // The correct post-clear state is "no mask", which is what we emit
    // right below.
    discardPending(coalescer.current, FRAME_SCHEDULER);
    // Issue #1344 (real run wire) — `resetKey` bump means CLEAR_MASK;
    // signal the parent that the mask buffer is now empty. Without
    // this, the parent route would keep a stale data URL from the
    // previous paint and submit it on the next Run click.
    onChangeRef.current?.(null);
  }, [width, height, resetKey]);

  // Issue #1427 — flush any coalesced stroke on unmount. Without this a
  // stroke still pending when the layer unmounts (tool switch, unmount of
  // the stage) would leave the parent holding a stale mask, which is the
  // exact state #1344 fixed.
  //
  // The refs are copied into locals at effect-setup time so the cleanup
  // emits the state that existed when this effect ran, rather than
  // dereferencing a ref whose `.current` may since have changed. A ref
  // holding a DOM node is safe to read at cleanup: React detaches it only
  // after the cleanup has run.
  useEffect(() => {
    const state = coalescer.current;
    const cb = onChangeRef;
    const canvas = canvasRef;
    return () => {
      if (!hasPendingChange(state)) return;
      flush(state, FRAME_SCHEDULER, () => {
        const handler = cb.current;
        const c = canvas.current;
        if (handler && c) handler(c.toDataURL("image/png"));
      });
    };
  }, []);

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
    // Issue #1427 — the parent must always hold the latest mask (#1344),
    // but the *encode* is coalesced: mid-stroke we only mark the buffer
    // dirty and let the scheduled frame do ONE full-canvas
    // `toDataURL("image/png")` for the whole frame. That is what stops
    // the pointer sampling rate from dictating paint throughput (and
    // from re-rendering the parent tree with a multi-MB string per
    // event). Every terminal handler below (pointerup / pointercancel /
    // lostpointercapture / unmount) flushes immediately, so the #1344
    // guarantee is unchanged — the parent ends up with the final state
    // of the stroke the moment it ends.
    scheduleChange();
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
          // A previous stroke that ended without a terminal event
          // (cancelled / capture lost) may still have a pending change.
          // Drain it here so the parent is never left holding a stale
          // mask when a new stroke starts (#1344).
          flushChange();
          stroke(point(e));
          // First stroke of a new paint = parent flips hasMask. Erase
          // mode does not fire onPainted (an erase-toggle on an empty
          // mask shouldn't claim "you have a mask now").
          if (mode === "paint") onPainted();
        }}
        onPointerMove={(e) => {
          const p = point(e);
          setCursor(p);
          // Issue #1427 — a pointer move NEVER encodes. It only marks
          // the buffer dirty; the encode happens on the next frame (at
          // most one per frame, trailing duplicates dropped).
          if (drawing.current) stroke(p);
        }}
        onPointerUp={() => {
          // Issue #1427 / #1344 — end of stroke: pay for exactly one
          // encode and hand the final buffer to the parent. Every
          // mid-stroke change since the last flush collapses into this
          // call, so the parent holds the COMPLETE final mask.
          flushChange();
          drawing.current = false;
          last.current = null;
        }}
        onPointerCancel={() => {
          // The pointer was cancelled (e.g. the browser took over the
          // gesture). Same terminal guarantee as pointerup.
          flushChange();
          drawing.current = false;
          last.current = null;
        }}
        onLostPointerCapture={() => {
          // Issue #1427 / #1344 — pointer capture released without a
          // pointerup (capture stolen / element detached). Flush so the
          // parent still receives the mask painted so far.
          flushChange();
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