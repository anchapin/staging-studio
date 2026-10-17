/**
 * Issue #1339 — CanvasStage + MaskLayer + CompareLayer + on-canvas object boxes.
 *
 * `useFitSize` measures the largest box of the requested `aspect` ratio
 * that fits inside the parent container. The Magic Patterns design keeps
 * the photo at the largest 3:2 box that fits the available area so the
 * photo is "the largest thing on the page, always" (issue design rule).
 *
 * Split into:
 *  - `computeFitSize` (pure math, pinned by
 *    `tests/edit-room-use-fit-size.test.ts`)
 *  - `useFitSize` (React effect: ResizeObserver → setState)
 *
 * The legacy `InpaintEditor` already measures the canvas the same way
 * via `usePhotoStackFit` / `useFitWidth` (see `inpaint-mask-canvas.tsx`
 * and its FitWidthStore). The two are intentionally separate — the
 * legacy surface stays untouched per the issue's "Do not touch" list,
 * and the new tree mounts its own observer scoped to the canvas-toolbar
 * area (smaller, scoped to one section). Sharing would couple the two
 * trees and re-import the canvas layer this slice is intentionally
 * independent of.
 */

import { useEffect, useRef, useState, type RefObject } from "react";

export interface FitSize {
  /** CSS-pixel width the canvas should render at. */
  w: number;
  /** CSS-pixel height the canvas should render at. */
  h: number;
}

export interface ComputeFitSizeInput {
  /** Available width of the parent container, in CSS px. */
  width: number;
  /** Available height of the parent container, in CSS px. */
  height: number;
  /** Target aspect ratio (width / height). The photo renders at this aspect. */
  aspect: number;
}

/**
 * Pure geometry: the largest `{w, h}` box of `aspect` ratio that fits
 * inside `width × height`. Returns `{w: 0, h: 0}` for empty /
 * non-finite containers so the caller can render an empty canvas (the
 * ResizeObserver fires once on mount with a real measurement shortly
 * after).
 *
 * Non-integer widths round down — the photo is then sized to integer
 * pixels so it never gets a sub-pixel seam when CSS rasterises it.
 */
export function computeFitSize({ width, height, aspect }: ComputeFitSizeInput): FitSize {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(aspect) ||
    width <= 0 ||
    height <= 0 ||
    aspect <= 0
  ) {
    return { w: 0, h: 0 };
  }
  // Width-bound: container is wider than `aspect`. Width = container,
  // height = width / aspect.
  // Height-bound: container is taller than `aspect`. Height = container,
  // width = height * aspect.
  const w = Math.min(width, height * aspect);
  return { w: Math.floor(w), h: Math.floor(w / aspect) };
}

/**
 * Measure `ref.current`'s client size (minus its CSS padding) on mount
 * and on every resize, then derive the largest aspect-fitting box and
 * return it as React state. The hook returns `null` until the first
 * measurement so callers can render an empty placeholder.
 */
export function useFitSize(
  ref: RefObject<HTMLElement | null>,
  aspect: number
): FitSize | null {
  const [size, setSize] = useState<FitSize | null>(null);
  // Re-measure on every aspect change without re-binding the observer
  // (a stable aspect shouldn't disconnect the observer; same as the
  // Magic Patterns reference). Issue #1288 pattern: the observer is
  // scoped to the element so it tears down with the React surface.
  const aspectRef = useRef(aspect);
  useEffect(() => {
    aspectRef.current = aspect;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const aw = el.clientWidth - (Number.isFinite(padX) ? padX : 0);
      const ah = el.clientHeight - (Number.isFinite(padY) ? padY : 0);
      setSize(computeFitSize({ width: aw, height: ah, aspect: aspectRef.current }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, aspect]);

  return size;
}