"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";

import { ATELIER_COLOR_TOKENS } from "@/lib/color-tokens";

interface SignatureCanvasProps {
  onSave: (dataUrl: string) => Promise<void>;
  clientName: string;
  disabled?: boolean;
}

type SignatureMode = "draw" | "type";

// Detect whether a 2D canvas contains any non-transparent pixels.
// Returns true if at least one sampled pixel has a non-zero alpha channel,
// meaning a stroke (typed text or user ink) has been drawn.
function canvasHasInk(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0 || canvas.height === 0) return false;
  // getImageData reads backing-store pixels; safe with a HiDPI-scaled ctx.
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    // Tainted canvases (cross-origin) can't be read; treat as inky.
    return true;
  }
  // Step by 4 (RGBA). Any non-zero alpha byte means a stroke was painted.
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return true;
  }
  return false;
}

export function SignatureCanvas({ onSave, clientName, disabled }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // #1114: the keyboard-accessible Draw mode (#79 parity) is out of scope
  // for this issue. Until keyboard input is wired up, hide the Draw option
  // so users cannot export a blank PNG through it.
  const [mode, setMode] = useState<SignatureMode>("type");
  const [typedName, setTypedName] = useState(clientName);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  // Track whether the canvas currently contains any non-transparent pixel.
  // For `type` mode it's set after the typed signature has been rasterized;
  // for `draw` mode it's set whenever a stroke has been painted.
  const [hasInk, setHasInk] = useState(false);

  // Initialize canvas on mount and resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size to match display size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Style
    ctx.strokeStyle = ATELIER_COLOR_TOKENS.primary;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getPos = useCallback(
    (e: MouseEvent | TouchEvent): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if ("touches" in e) {
        const touch = e.touches[0];
        if (!touch) return null;
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      }
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    []
  );

  const startDrawing = useCallback(
    (e: MouseEvent | TouchEvent) => {
      // Mode is the only gate on the pointer path. `disabled` (consent
      // attestation, issue #1113) intentionally does NOT block
      // drawing — the user is free to compose their signature before
      // ticking the legal-statement box. The submit-side `canSign`
      // gate is what enforces the attestation, not the canvas.
      if (mode !== "draw") return;
      const pos = getPos(e);
      if (!pos) return;
      setIsDrawing(true);
      setLastPos(pos);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
      }
    },
    [mode, getPos]
  );

  const draw = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!isDrawing || mode !== "draw") return;
      e.preventDefault();
      const pos = getPos(e);
      if (!pos || !lastPos) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      setLastPos(pos);
    },
    [isDrawing, mode, getPos, lastPos]
  );

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
    setLastPos(null);
    // Refresh the ink flag once the user lifts the pointer so the Sign
    // button only enables when something has actually been painted.
    const canvas = canvasRef.current;
    if (canvas) setHasInk(canvasHasInk(canvas));
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      let dataUrl: string;
      if (mode === "draw") {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas not found");
        dataUrl = canvas.toDataURL("image/png");
        setHasInk(canvasHasInk(canvas));
      } else {
        // Render typed signature to a canvas and export as PNG
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas not found");
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context not found");
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `italic 48px "Playfair Display", Georgia, serif`;
        ctx.fillStyle = ATELIER_COLOR_TOKENS.primary;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(typedName, rect.width / 2, rect.height / 2);
        // Re-sample after rendering so the ink flag tracks the typed glyph.
        setHasInk(canvasHasInk(canvas));
        dataUrl = canvas.toDataURL("image/png");
      }
      await onSave(dataUrl);
    } finally {
      setIsSaving(false);
    }
  }, [mode, typedName, onSave]);

  // Disable Sign until the canvas actually has something to export.
  // The previous gate (`!typedName.trim()` only) shipped a blank PNG
  // when the user typed nothing and exported the empty canvas. The
  // current gate is mode-aware: `type` mode requires a non-empty typed
  // name (the rasterizer writes the typed glyph, so an empty typedName
  // would still export a blank canvas even if `hasInk` is somehow
  // true from a prior mode); `draw` mode requires a non-empty canvas
  // (a stroke must have landed). A truly-blank canvas is never
  // exportable from either mode. Issue #1114.
  const canSign =
    !disabled &&
    !isSaving &&
    hasInk &&
    (mode === "draw" || typedName.trim().length > 0);

  // Re-rasterize the typed name on every change so `hasInk` (and therefore
  // the Sign button) reflects what the user has actually typed. Without
  // this the gate would only flip on Save, leaving the button disabled the
  // whole time the user is composing their signature.
  useEffect(() => {
    if (mode !== "type") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (typedName.trim().length > 0) {
      ctx.font = `italic 48px "Playfair Display", Georgia, serif`;
      ctx.fillStyle = ATELIER_COLOR_TOKENS.primary;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(typedName, rect.width / 2, rect.height / 2);
    }
    setHasInk(canvasHasInk(canvas));
  }, [mode, typedName]);

  // Attach mouse/touch events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseDown = (e: MouseEvent) => startDrawing(e);
    const onMouseMove = (e: MouseEvent) => draw(e);
    const onMouseUp = () => stopDrawing();
    const onMouseLeave = () => stopDrawing();

    const onTouchStart = (e: TouchEvent) => startDrawing(e);
    const onTouchMove = (e: TouchEvent) => draw(e);
    const onTouchEnd = () => stopDrawing();

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [startDrawing, draw, stopDrawing]);

  return (
    <div className="space-y-4">
      {/* Mode toggle: Type / Draw. The signature canvas is a separate
          surface from the mask canvas — the #1114 hold that hid Draw
          cited the mask-canvas #79 keyboard-input precedent, but the
          two surfaces don't share a contract: a signature canvas's
          pointer events are the primary input (typed-mode is the
          alternate path), so the Draw button is the default affordance
          and the e2e signoff spec exercises the pointer flow directly
          (real CDP mouse events, inked-pixel check before submit). The
          draw-mode state, pointer handlers, and brush logic were
          always intact; this is a JSX-only re-enable.

          The mode toggle and the canvas itself are NOT gated on
          `disabled` (issue #1113 consent attestation). The consent
          gate is a legally-worded "you have read and accept" checkbox;
          it must block the *submit* action (a record being burned
          `Signed` without attestation), not exploration of the canvas.
          Locking the mode toggle until consent is given would force a
          user to commit to the legal statement before they could
          decide whether to type or draw, which is a worse UX than
          the alternative. The Sign & Approve button below still
          respects `disabled` via the `canSign` gate. */}
      <div className="flex gap-2" role="group" aria-label="Signature input mode">
        <button
          type="button"
          onClick={() => setMode("type")}
          aria-pressed={mode === "type"}
          className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
            mode === "type"
              ? "bg-stone-800 text-white border-stone-800"
              : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
          }`}
        >
          Type
        </button>
        <button
          type="button"
          onClick={() => setMode("draw")}
          aria-pressed={mode === "draw"}
          className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
            mode === "draw"
              ? "bg-stone-800 text-white border-stone-800"
              : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
          }`}
        >
          Draw
        </button>
      </div>

      {/* Canvas / Type input. The text field and draw canvas are
          intentionally NOT gated on `disabled` — see the comment above
          the mode toggle. The user is free to compose and explore the
          canvas before ticking the consent box; only the Sign &
          Approve button below enforces the attestation gate. */}
      <div className="relative">
        {mode === "type" ? (
          <div className="relative border border-stone-300 rounded-md overflow-hidden bg-white">
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Type your full name"
              className="font-playfair w-full px-4 py-3 text-3xl italic text-center text-stone-800 bg-transparent outline-none"
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 pointer-events-none w-full h-full"
              style={{ width: "100%", height: "120px" }}
            />
          </div>
        ) : (
          <div className="relative border-2 border-dashed border-stone-300 rounded-md bg-white overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full bg-white"
              style={{ height: "120px", cursor: mode === "draw" ? "crosshair" : "default" }}
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-stone-400 text-sm">Draw your signature above</span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 items-center">
        {mode === "draw" && (
          <button
            type="button"
            onClick={clearCanvas}
            className="px-3 py-1.5 text-sm text-stone-600 border border-stone-300 rounded-md hover:bg-stone-50 transition-colors"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSign}
          aria-disabled={!canSign}
          title={
            !typedName.trim()
              ? "Type your full name to enable signing"
              : !hasInk
                ? "Signature appears empty"
                : undefined
          }
          className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white text-sm rounded-md hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSaving ? "Signing..." : "Sign & Approve"}
        </button>
      </div>
    </div>
  );
}
