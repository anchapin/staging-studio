/**
 * Issue #1339 — CanvasStage + MaskLayer + CompareLayer + on-canvas object boxes.
 *
 * `CompareLayer` is the draggable comparison divider over the photo. The
 * original photo is shown on the LEFT of the divider (clip-path from the
 * right); the staged photo is the underlying canvas.
 *
 * Magic Patterns reference:
 * `dVy8jC2kXpi1ca8b4A1hcS/components/CompareLayer.tsx`. The geometry math
 * is delegated to `src/lib/comparison-slider-geometry.ts` (`#1279`
 * already pinned `sliderPercentFromClientX` / `nudgeSliderPercent` /
 * `sliderClipPath` / `clampSliderPercent`). This component is the
 * React wrapper that wires the pointer + keyboard handlers around it.
 *
 * Keyboard step is ±2 per the design (the legacy `ComparisonSlider`
 * uses ±5, but that component is for the read-only report view; this
 * is the editing surface where ±2 is closer to "1px" of nudge for a
 * typical canvas width).
 */

import { useRef, useState } from "react";

import {
  clampSliderPercent,
  sliderClipPath,
  sliderPercentFromClientX,
} from "@/lib/comparison-slider-geometry";

/** Percentage moved per ArrowLeft / ArrowRight keypress on the canvas. */
const CANVAS_KEYBOARD_STEP = 2;

export interface CompareLayerProps {
  /** URL of the original (pre-staging) photo to overlay. */
  originalUrl: string;
}

/** Original photo clipped to the left of a draggable divider. */
export function CompareLayer({ originalUrl }: CompareLayerProps) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(sliderPercentFromClientX(clientX, rect));
  };

  return (
    <div
      ref={ref}
      className="absolute inset-0 cursor-ew-resize select-none"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        update(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && update(e.clientX)}
      onPointerUp={() => {
        dragging.current = false;
      }}
    >
      <img
        src={originalUrl}
        alt="Original (unstaged)"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: sliderClipPath(pos) }}
      />
      <div
        className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white"
        style={{ left: `${pos}%` }}
      >
        <div
          role="slider"
          aria-label="Comparison position"
          aria-valuenow={Math.round(pos)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              setPos((p) => clampSliderPercent(p - CANVAS_KEYBOARD_STEP));
            } else if (e.key === "ArrowRight") {
              setPos((p) => clampSliderPercent(p + CANVAS_KEYBOARD_STEP));
            }
          }}
          className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-md"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="M6 4L2 8l4 4M10 4l4 4-4 4"
              stroke="#181716"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
      <span className="pointer-events-none absolute left-3 top-3 rounded bg-walnut/80 px-2 py-0.5 text-xs font-medium text-on-walnut">
        Original
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded bg-walnut/80 px-2 py-0.5 text-xs font-medium text-on-walnut">
        Staged
      </span>
    </div>
  );
}