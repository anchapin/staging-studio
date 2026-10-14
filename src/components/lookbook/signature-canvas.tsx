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
      if (mode !== "draw" || disabled) return;
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
    [mode, disabled, getPos]
  );

  const draw = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!isDrawing || mode !== "draw" || disabled) return;
      e.preventDefault();
      const pos = getPos(e);
      if (!pos || !lastPos) return;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      setLastPos(pos);
    },
    [isDrawing, mode, disabled, getPos, lastPos]
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

  // #1114: disable Sign until both a typed name AND a non-empty canvas exist.
  // The previous gate (`!typedName.trim()` only) shipped a blank PNG when the
  // user typed nothing and exported the empty canvas.
  const canSign =
    !disabled && !isSaving && typedName.trim().length > 0 && hasInk;

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
      {/* Mode toggle — #1114: the Draw button is intentionally hidden until
          a keyboard-input path is implemented (mirroring mask-canvas #79).
          The draw-mode state, pointer handlers, and brush logic are all
          still intact in this component; re-enabling is a one-line JSX
          change. Until then the only one-trust surface for the canvas is
          the typed input, gated on both typedName and a non-empty
          rasterized canvas (no blank PNG can ship). */}
      <div className="flex gap-2" role="group" aria-label="Signature input mode">
        <button
          type="button"
          onClick={() => setMode("type")}
          disabled={disabled}
          aria-pressed={mode === "type"}
          className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
            mode === "type"
              ? "bg-stone-800 text-white border-stone-800"
              : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          Type
        </button>
      </div>

      {/* Canvas / Type input */}
      <div className="relative">
        {mode === "type" ? (
          <div className="relative border border-stone-300 rounded-md overflow-hidden bg-white">
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              disabled={disabled}
              placeholder="Type your full name"
              className="font-playfair w-full px-4 py-3 text-3xl italic text-center text-stone-800 bg-transparent outline-none disabled:opacity-50"
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
              className={`w-full bg-white ${disabled ? "opacity-50" : ""}`}
              style={{ height: "120px", cursor: mode === "draw" && !disabled ? "crosshair" : "default" }}
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
            disabled={disabled}
            className="px-3 py-1.5 text-sm text-stone-600 border border-stone-300 rounded-md hover:bg-stone-50 transition-colors disabled:opacity-50"
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
