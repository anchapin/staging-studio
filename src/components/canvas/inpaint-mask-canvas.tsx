"use client";

import { useRef, useState, useEffect, useCallback, useMemo, useId } from "react";
import { Loader2 } from "lucide-react";
import {
  clientPointToCanvas,
  computeBackingStoreDimensions,
  computeMaskCanvasDimensions,
  logicalPointToBackingStore,
  type CanvasPoint,
} from "@/lib/canvas-coords";
import { estimateMaskCoverage, shouldWarnLowCoverage } from "@/lib/mask-coverage";
import { extractMaskOutline, paintMaskPixels } from "@/lib/mask-format";
import { floodFillMask, maskGridFromPixels } from "@/lib/mask-flood-fill";
import {
  DEFAULT_MASK_EXPANSION_RADIUS,
  dilateMaskGrid,
} from "@/lib/mask-dilation";
import { fillHoles } from "@/lib/mask-postprocess";
import { SAM_TOOL_ENABLED } from "@/lib/sam-tool";

/** Tools for building the mask: freehand paint, flood-fill, or concept select. */
type MaskTool = "brush" | "fill" | "select";

/**
 * Rank→color palette for instance overlays (issue #228). Six hues,
 * cycled by score rank, so adjacent instances stay distinguishable. RGB
 * tuples feed `paintMaskPixels` directly (issue #248).
 */
const INSTANCE_OVERLAY_PALETTE: Array<readonly [number, number, number]> = [
  [0x22, 0xc5, 0x5f],
  [0xf9, 0x73, 0x16],
  [0x3b, 0x82, 0xf6],
  [0xa8, 0x55, 0xf7],
  [0x06, 0xb6, 0xd4],
  [0xea, 0xb3, 0x08],
];

/**
 * Issue #249: detected-only vs selected must be distinguishable at a
 * glance. A detected-only instance renders as a FAINT rank-colored wash
 * plus a crisp rank-colored outline; a selected one renders as a solid
 * rank-colored fill. (The pre-#249 scheme tinted both the same way and
 * only dimmed selected — on a furnished room that read as "everything
 * is selected".)
 */
const DETECTED_WASH_ALPHA = 0.15;
const SELECTED_FILL_ALPHA = 0.45;

/**
 * Issue #203: editor-side sync of the batch selection set. Whenever `id`
 * changes, the mask grid is re-initialized from `maskDataUrl` — the union
 * of every pending selection (or cleared when null). The grid is REPLACED
 * rather than merged because removals cannot be un-painted. A single
 * Select Object click (issue #183 flow) is the one-element case.
 */
export interface SelectionReset {
  id: number;
  maskDataUrl: string | null;
}

/** Issue #203: one numbered badge marking a pending batch selection. */
export interface SelectionMarker {
  id: string;
  /** Click point in the photo's natural pixel space. */
  x: number;
  y: number;
  /** 1-based position in the selection set. */
  index: number;
}

/**
 * Issue #228: one detected concept instance to tint on the overlay
 * canvas. `rank` is the score rank (0 = highest score) and picks the
 * palette color; issue #249 splits the rendering — `selected` instances
 * render as a solid rank-colored fill (their pixels are already in the
 * white mask canvas above), detected-only ones as a faint wash with a
 * rank-colored outline.
 */
export interface InstanceOverlay {
  /** Stable React key (concept + response position). */
  id: string;
  /** The provider mask (data URL; grayscale or alpha cutout) to tint. */
  maskDataUrl: string;
  /** Score rank, 0-based. */
  rank: number;
  selected: boolean;
}

interface InpaintMaskCanvasProps {
  width?: number;
  height?: number;
  brushSize?: number;
  initialMaskDataUrl?: string | null;
  onMaskChange?: (maskDataUrl: string | null) => void;
  /** Natural aspect ratio (width / height) of the source photo; sizes the mask canvas to match it. */
  aspectRatio?: number | null;
  /** Natural pixel width of the uploaded photo; exported masks are scaled to match. */
  naturalWidth?: number | null;
  /** Natural pixel height of the uploaded photo. */
  naturalHeight?: number | null;
  /** Photo rendered underneath the mask so the canvas overlays it exactly. */
  overlayImageSrc?: string | null;
  /**
   * Full-width focused layout (issue #169): the photo + mask span the
   * available content width instead of the compact card cap (`max-w-md`).
   */
  fullWidth?: boolean;
  /**
   * Select Objects tool (issue #228): called on click with the point in
   * LOGICAL canvas pixel space (dims — the same space the parent decodes
   * instance grids at). The parent hit-tests client-side; no provider
   * call happens on click. Repeated clicks are MEANINGFUL (toggle), so
   * unlike the old point-SAM flow there is no same-point dedupe.
   */
  onInstanceToggle?: (point: CanvasPoint) => void;
  /** True while segmenting (or inpainting) runs; select clicks are ignored. */
  segmentDisabled?: boolean;
  /**
   * True while a concept detection is in flight (issue #228, formerly the
   * per-click SAM request): shows a spinner + "Selecting..." on the
   * Select Objects tool itself and a wait cursor on the canvas.
   */
  segmenting?: boolean;
  /**
   * Issue #228: score-ranked detected instances to tint beneath the mask
   * canvas. Pure DOM/canvas overlay — never touches the exported mask.
   */
  instanceOverlays?: InstanceOverlay[];
  /**
   * Outward mask growth in mask-canvas pixels applied at export time
   * (issue #180): makes FLUX.1 Fill regenerate bezels/frames at the painted
   * boundary instead of preserving them. 0 restores the un-dilated mask.
   */
  expansionRadius?: number;
  /**
   * Issue #203: numbered badges (1-based) for each pending batch selection,
   * positioned by natural-pixel click point. Pure DOM overlay — like the
   * brush cursor, they never touch canvas pixels, so the exported mask
   * stays clean.
   */
  selectionMarkers?: SelectionMarker[];
  /**
   * Issue #203: replace the mask grid with this union mask whenever `id`
   * changes (a selection was added, removed, or cleared). `maskDataUrl`
   * null clears the grid. Single-select (issue #183) flows through the
   * same path: one selection's union is its own mask.
   */
  selectionReset?: SelectionReset | null;
  /** Issue #203: the user pressed Clear Mask; lets the parent drop the
   * batch selection set so it cannot disagree with the now-empty grid. */
  onMaskCleared?: () => void;
}

export default function InpaintMaskCanvas({
  width = 512,
  height = 512,
  brushSize: initialBrushSize = 20,
  initialMaskDataUrl,
  onMaskChange,
  aspectRatio,
  naturalWidth,
  naturalHeight,
  overlayImageSrc,
  fullWidth = false,
  onInstanceToggle,
  segmentDisabled = false,
  segmenting = false,
  instanceOverlays,
  expansionRadius = DEFAULT_MASK_EXPANSION_RADIUS,
  selectionMarkers,
  selectionReset = null,
  onMaskCleared,
}: InpaintMaskCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(initialBrushSize);
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(initialMaskDataUrl ?? null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Masking-guidance state: which tool is active, whether anything has been
  // painted yet (drives the empty-state hint), and whether the exported mask
  // is suspiciously tiny (drives the low-coverage warning).
  const [activeTool, setActiveTool] = useState<MaskTool>("brush");
  const [hasPainted, setHasPainted] = useState(false);
  const [lowCoverage, setLowCoverage] = useState(false);

  // Keyboard painting: the virtual brush cursor lives in canvas pixel space
  // (the same space clientPointToCanvas produces) so arrow-key deltas scale
  // with the canvas resolution, not with client pixels.
  const [isCanvasFocused, setIsCanvasFocused] = useState(false);
  const [isKeyboardPainting, setIsKeyboardPainting] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const keyboardPaintingRef = useRef(false);
  const hintId = useId();
  const maskingHintId = useId();

  // Canvas resolution follows the photo's aspect ratio (capped on the long
  // edge); without one, fall back to the plain width/height props.
  const dims = useMemo(
    () =>
      aspectRatio && aspectRatio > 0
        ? computeMaskCanvasDimensions(aspectRatio)
        : { width, height },
    [aspectRatio, width, height]
  );

  // HiDPI support (issue #181): all painting happens in LOGICAL canvas
  // space (dims, the same space clientPointToCanvas produces). The backing
  // store is scaled up to device pixels and the 2D context is transformed
  // by the same ratio, so strokes render crisp at native resolution and
  // pointer coordinates land under the cursor on any display scaling.
  // devicePixelRatio is read after mount (SSR/pre-hydration renders as 1)
  // and tracked across zoom / monitor changes via resize.
  const [devicePixelRatio, setDevicePixelRatio] = useState(1);
  useEffect(() => {
    const syncRatio = () => setDevicePixelRatio(window.devicePixelRatio || 1);
    syncRatio();
    window.addEventListener("resize", syncRatio);
    return () => window.removeEventListener("resize", syncRatio);
  }, []);

  const backing = useMemo(
    () => computeBackingStoreDimensions(dims.width, dims.height, devicePixelRatio),
    [dims.width, dims.height, devicePixelRatio]
  );

  const hasOverlay = Boolean(overlayImageSrc);

  // ---------------------------------------------------------------------
  // Issue #228: score-ranked instance overlays. A dedicated canvas layer
  // (below the interactive mask canvas) tints each detected instance by
  // rank; since issue #249 selected instances render as a solid fill
  // (their pixels already show as white in the mask canvas above) while
  // detected-only ones stay a faint wash plus an outline. This layer is
  // decorative only — it never touches the exported mask pixels.
  // ---------------------------------------------------------------------
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const instanceImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [overlayTick, setOverlayTick] = useState(0);

  // Preload instance cutout images once per response; the draw effect
  // reads them from the cache. Failed decodes cache a zero-width image
  // and are skipped at draw time.
  useEffect(() => {
    if (!instanceOverlays || instanceOverlays.length === 0) return;
    let cancelled = false;
    const cache = instanceImageCacheRef.current;
    for (const overlay of instanceOverlays) {
      if (cache.has(overlay.maskDataUrl)) continue;
      const img = new Image();
      img.onload = () => {
        if (!cancelled) setOverlayTick((tick) => tick + 1);
      };
      img.onerror = () => {
        if (!cancelled) setOverlayTick((tick) => tick + 1);
      };
      cache.set(overlay.maskDataUrl, img);
      img.src = overlay.maskDataUrl;
    }
    return () => {
      cancelled = true;
    };
  }, [instanceOverlays]);

  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = overlayCanvas?.getContext("2d");
    if (!overlayCanvas || !ctx) return;
    ctx.clearRect(0, 0, dims.width, dims.height);
    if (!instanceOverlays || instanceOverlays.length === 0) return;
    const cache = instanceImageCacheRef.current;
    for (const overlay of instanceOverlays) {
      const img = cache.get(overlay.maskDataUrl);
      if (!img || !img.complete || !img.naturalWidth) continue;
      const paletteColor =
        INSTANCE_OVERLAY_PALETTE[overlay.rank % INSTANCE_OVERLAY_PALETTE.length];
      // Tint the mask with the rank color: alpha is DERIVED from the
      // format-agnostic classification (issue #248) — a grayscale provider
      // mask decodes fully opaque, which the replaced `source-in` fill
      // trusted and painted frame-wide.
      const tinted = document.createElement("canvas");
      tinted.width = dims.width;
      tinted.height = dims.height;
      const tintedCtx = tinted.getContext("2d");
      if (!tintedCtx) continue;
      tintedCtx.drawImage(img, 0, 0, dims.width, dims.height);
      const tintedData = paintMaskPixels(
        tintedCtx.getImageData(0, 0, dims.width, dims.height).data,
        dims.width,
        dims.height,
        {
          maskedColor: paletteColor,
          transparentBackground: true,
        }
      );
      // Issue #249: selected = solid rank-colored fill; detected-only =
      // faint wash PLUS a crisp rank-colored outline, so "detected" and
      // "selected" are distinguishable at a glance on furnished rooms.
      tintedCtx.putImageData(
        new ImageData(new Uint8ClampedArray(tintedData), dims.width, dims.height),
        0,
        0
      );
      ctx.globalAlpha = overlay.selected ? SELECTED_FILL_ALPHA : DETECTED_WASH_ALPHA;
      ctx.drawImage(tinted, 0, 0);
      if (!overlay.selected) {
        const outlineData = extractMaskOutline(tintedData, dims.width, dims.height, {
          outlineColor: paletteColor,
        });
        const outlined = document.createElement("canvas");
        outlined.width = dims.width;
        outlined.height = dims.height;
        const outlinedCtx = outlined.getContext("2d");
        if (!outlinedCtx) continue;
        outlinedCtx.putImageData(
          new ImageData(new Uint8ClampedArray(outlineData), dims.width, dims.height),
          0,
          0
        );
        ctx.globalAlpha = 1;
        ctx.drawImage(outlined, 0, 0);
      }
    }
    ctx.globalAlpha = 1;
  }, [instanceOverlays, overlayTick, dims.width, dims.height]);


  // Latest initial mask without making initCanvas depend on it — re-running
  // init on every parent render would wipe in-progress strokes.
  const initialMaskRef = useRef(initialMaskDataUrl);
  useEffect(() => {
    initialMaskRef.current = initialMaskDataUrl;
  }, [initialMaskDataUrl]);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Painting stays in logical (dims) coordinates; this transform maps it
    // onto the DPR-scaled backing store. Setting the canvas size (below,
    // via React) resets the context, so re-apply it on every (re)init.
    const dpr = backing.width / dims.width || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const initial = initialMaskRef.current;
    if (initial) {
      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, dims.width, dims.height);
        ctx.drawImage(img, 0, 0, dims.width, dims.height);
      };
      img.src = initial;
    } else {
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, dims.width, dims.height);
    }
    // Re-initializing replaces the canvas content, so reset the guidance
    // state to match what will actually be on screen.
    setHasPainted(Boolean(initial));
    setLowCoverage(false);
  }, [dims.width, dims.height, backing]);

  // Initialize once on mount, and re-initialize when the geometry changes
  // (e.g. the photo's aspect ratio resolves after the image loads) or when
  // the underlying photo itself changes (issue #170 source switching) — a
  // mask drawn for one image must never survive onto the next. The ref sync
  // effect above runs first, so initCanvas reads the latest initial mask.
  useEffect(() => {
    initCanvas();
  }, [initCanvas, overlayImageSrc]);

  const getCoordinates = (
    e: React.MouseEvent | React.TouchEvent
  ): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();

    // Scale basis (issue #181): pointers map into the LOGICAL canvas space
    // (dims), never the DPR-scaled backing store (canvas.width/height). The
    // context transform carries logical coordinates onto physical pixels,
    // so painted strokes land exactly under the cursor at any device
    // pixel ratio.
    if ("touches" in e) {
      const touch = e.touches[0];
      if (!touch) return null;
      return clientPointToCanvas(touch.clientX, touch.clientY, rect, dims.width, dims.height);
    }

    return clientPointToCanvas(e.clientX, e.clientY, rect, dims.width, dims.height);
  };

  const draw = (
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.strokeStyle = "white";
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  // A zero-length stroked line renders inconsistently across browsers, so
  // single-point paints (keyboard toggle-down, no movement yet) fill a disc.
  const drawDot = (at: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(at.x, at.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  // Fill Region tool: flood-fills the unpainted region connected to the
  // click/cursor point with painted pixels. Designed for cover-the-object
  // semantics — draw a continuous outline around the object, then fill its
  // interior in one click instead of painting it by hand. Returns true when
  // pixels changed.
  const performFill = (point: { x: number; y: number }): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    // getImageData/putImageData operate on PHYSICAL pixels and ignore the
    // context transform, so the logical-space seed is mapped into backing
    // store pixels before flooding (issue #181).
    const seed = logicalPointToBackingStore(point, devicePixelRatio, backing);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const grid = maskGridFromPixels(imageData.data, canvas.width, canvas.height);
    const result = floodFillMask(grid, canvas.width, canvas.height, seed.x, seed.y);
    if (!result || result.filledCount === 0) return false;

    // Snap filled (and already-painted) cells to pure white so the exported
    // mask keeps clean region-replacement semantics.
    const data = imageData.data;
    for (let i = 0; i < result.mask.length; i++) {
      if (result.mask[i] === 1) {
        const o = i * 4;
        data[o] = 255;
        data[o + 1] = 255;
        data[o + 2] = 255;
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return true;
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const point = getCoordinates(e);
    if (!point) return;
    if (activeTool === "select") {
      handleInstanceClick(point);
      return;
    }
    if (activeTool === "fill") {
      if (performFill(point)) {
        setHasPainted(true);
        exportMask();
      }
      return;
    }
    setIsDrawing(true);
    lastPointRef.current = point;
    setHasPainted(true);
    draw(point, point);
  };

  // Select Objects tool (issue #228): hands the clicked LOGICAL canvas
  // point to the parent, which hit-tests it against the decoded concept
  // instances — zero provider calls per click. Repeated clicks on the
  // same point are meaningful (toggle in/out), so there is no dedupe.
  const handleInstanceClick = (canvasPoint: CanvasPoint) => {
    if (!onInstanceToggle || segmentDisabled) return;
    onInstanceToggle(canvasPoint);
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing || !lastPointRef.current) return;
    const point = getCoordinates(e);
    if (!point) return;
    draw(lastPointRef.current, point);
    lastPointRef.current = point;
  };

  const handleEnd = () => {
    if (isDrawing) {
      setIsDrawing(false);
      lastPointRef.current = null;
      exportMask();
    }
  };

  const exportMask = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // fal-ai/flux-fill expects the mask geometry to match the source image,
    // so rescale the painted mask to the photo's natural pixel dimensions.
    const exportWidth =
      naturalWidth && naturalWidth > 0 ? Math.max(1, Math.round(naturalWidth)) : canvas.width;
    const exportHeight =
      naturalHeight && naturalHeight > 0 ? Math.max(1, Math.round(naturalHeight)) : canvas.height;

    // Issue #180: grow the painted mask outward before export so bezels,
    // frames, brackets, and mounts at the painted boundary are regenerated
    // instead of preserved. Dilation runs in logical mask-canvas pixel space
    // (dims) BEFORE the scale-to-natural-dimensions step and only rewrites
    // mask pixels — the source photo is never touched. A radius of 0 keeps
    // the un-dilated mask.
    //
    // Issue #252 D3: filling runs LAST in the composition pipeline —
    // dilation can seal unpainted pockets — so every manual mask reaching
    // /api/inpaint is hole-free ("no donut reaches FLUX"). Strokes stay raw
    // while drawing; this is the run-composition point.
    let maskSource: HTMLCanvasElement = canvas;
    {
      const paint = document.createElement("canvas");
      paint.width = dims.width;
      paint.height = dims.height;
      const paintCtx = paint.getContext("2d");
      if (!paintCtx) return;
      paintCtx.drawImage(canvas, 0, 0, dims.width, dims.height);
      const paintData = paintCtx.getImageData(0, 0, dims.width, dims.height);
      const grid = maskGridFromPixels(paintData.data, dims.width, dims.height);
      const dilated =
        expansionRadius > 0
          ? dilateMaskGrid(grid, dims.width, dims.height, expansionRadius)
          : null;
      if (expansionRadius > 0 && !dilated) return;
      const baseMask = dilated ? dilated.mask : grid;
      const filled = fillHoles(baseMask, dims.width, dims.height);
      const finalMask = filled ? filled.mask : baseMask;

      const grown = paintCtx.createImageData(dims.width, dims.height);
      const grownData = grown.data;
      for (let i = 0; i < finalMask.length; i++) {
        const o = i * 4;
        if (finalMask[i] === 1) {
          grownData[o] = 255;
          grownData[o + 1] = 255;
          grownData[o + 2] = 255;
        }
        grownData[o + 3] = 255;
      }
      paintCtx.putImageData(grown, 0, 0);
      maskSource = paint;
    }

    let dataUrl: string;
    if (exportWidth === maskSource.width && exportHeight === maskSource.height) {
      dataUrl = maskSource.toDataURL("image/png");
    } else {
      const scaled = document.createElement("canvas");
      scaled.width = exportWidth;
      scaled.height = exportHeight;
      const scaledCtx = scaled.getContext("2d");
      if (!scaledCtx) return;
      scaledCtx.drawImage(maskSource, 0, 0, exportWidth, exportHeight);
      dataUrl = scaled.toDataURL("image/png");
    }

    setMaskDataUrl(dataUrl);
    onMaskChange?.(dataUrl);

    // Surface a low-coverage warning when the mask looks like a stray stroke
    // or an outline-only mistake (cover-the-object semantics). Coverage is a
    // ratio, so reading it from the paint canvas is equivalent to reading it
    // from the scaled export.
    if (ctx) {
      const coverage = estimateMaskCoverage(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height
      );
      setLowCoverage(shouldWarnLowCoverage(coverage));
    }
  }, [naturalWidth, naturalHeight, onMaskChange, expansionRadius, dims.width, dims.height]);

  // Re-export when the expansion radius changes so the dispatched mask
  // always reflects the current dilation setting (issue #180). Refs keep the
  // effect from firing on mount or on unrelated geometry changes — the mask
  // is only re-exported once something has actually been painted.
  const hasPaintedRef = useRef(hasPainted);
  useEffect(() => {
    hasPaintedRef.current = hasPainted;
  }, [hasPainted]);

  const lastAppliedRadiusRef = useRef(expansionRadius);
  useEffect(() => {
    const previous = lastAppliedRadiusRef.current;
    lastAppliedRadiusRef.current = expansionRadius;
    if (previous === expansionRadius) return;
    if (!hasPaintedRef.current) return;
    exportMask();
  }, [expansionRadius, exportMask]);

  const clearMask = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, dims.width, dims.height);
    setMaskDataUrl(null);
    setHasPainted(false);
    setLowCoverage(false);
    onMaskChange?.(null);
    // Issue #203: the grid is now empty — the parent must drop the batch
    // selection set so the panel can't disagree with the canvas (the
    // resulting empty-set reset below re-initializes to black, idempotent).
    onMaskCleared?.();
  };

  // Issue #203: batch selection sync — replaces the #183 incremental
  // segment merge. The grid must always equal the union of the current
  // selection set, so ANY set change (add, undo-last, remove, clear)
  // re-initializes the grid from the editor-composed union mask instead of
  // merging (removals cannot be un-painted, and re-composing keeps the
  // grid provably consistent with the panel's list). Manual strokes made
  // on top of a selection are rebuilt away by design: while the selection
  // set exists it is the source of truth (the batch panel says so).
  const lastAppliedResetRef = useRef<number>(-1);
  useEffect(() => {
    if (!selectionReset || selectionReset.id === lastAppliedResetRef.current) return;
    lastAppliedResetRef.current = selectionReset.id;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    if (!selectionReset.maskDataUrl) {
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, dims.width, dims.height);
      setMaskDataUrl(null);
      setHasPainted(false);
      setLowCoverage(false);
      onMaskChange?.(null);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, dims.width, dims.height);
      ctx.drawImage(img, 0, 0, dims.width, dims.height);
      setHasPainted(true);
      exportMask();
    };
    img.src = selectionReset.maskDataUrl;
    return () => {
      cancelled = true;
    };
  }, [selectionReset, dims.width, dims.height, exportMask, onMaskChange]);

  // The virtual brush cursor lives in LOGICAL canvas space — the same
  // space clientPointToCanvas produces and the DOM cursor indicator
  // positions against (issue #181 keeps it DPR-independent).
  const centerOf = () => ({
    x: dims.width / 2,
    y: dims.height / 2,
  });

  const moveCursorTo = (next: { x: number; y: number }) => {
    const point = {
      x: Math.min(Math.max(next.x, 0), dims.width),
      y: Math.min(Math.max(next.y, 0), dims.height),
    };
    if (keyboardPaintingRef.current) {
      const from = cursorRef.current ?? point;
      draw(from, point);
    }
    cursorRef.current = point;
    setCursor(point);
  };

  const liftKeyboardPaint = () => {
    if (!keyboardPaintingRef.current) return;
    keyboardPaintingRef.current = false;
    setIsKeyboardPainting(false);
    exportMask();
  };

  const toggleKeyboardPaint = () => {
    if (!canvasRef.current) return;
    if (activeTool === "select") {
      const at = cursorRef.current ?? centerOf();
      cursorRef.current = at;
      setCursor(at);
      handleInstanceClick(at);
      return;
    }
    if (activeTool === "fill") {
      const at = cursorRef.current ?? centerOf();
      cursorRef.current = at;
      setCursor(at);
      if (performFill(at)) {
        setHasPainted(true);
        exportMask();
      }
      return;
    }
    if (keyboardPaintingRef.current) {
      liftKeyboardPaint();
      return;
    }
    const at = cursorRef.current ?? centerOf();
    cursorRef.current = at;
    setCursor(at);
    keyboardPaintingRef.current = true;
    setIsKeyboardPainting(true);
    setHasPainted(true);
    drawDot(at);
  };

  const ARROW_DELTAS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const delta = ARROW_DELTAS[e.key];
    if (delta) {
      e.preventDefault();
      const fraction = e.shiftKey ? 0.01 : 0.05;
      const current = cursorRef.current ?? centerOf();
      moveCursorTo({
        x: current.x + delta[0] * dims.width * fraction,
        y: current.y + delta[1] * dims.height * fraction,
      });
      return;
    }

    if (e.key === "p" || e.key === "P" || e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggleKeyboardPaint();
    }
  };

  const handleCanvasFocus = () => {
    setIsCanvasFocused(true);
    const canvas = canvasRef.current;
    if (canvas && !cursorRef.current) {
      const at = centerOf();
      cursorRef.current = at;
      setCursor(at);
    }
  };

  const handleCanvasBlur = () => {
    setIsCanvasFocused(false);
    liftKeyboardPaint();
  };

  // Issue #203: while a batch selection set exists, numbered badges mark
  // each pending object at its click point. Like the brush cursor this is
  // a DOM overlay — never canvas pixels — so the exported mask stays clean.
  const markerSpace = {
    width: naturalWidth && naturalWidth > 0 ? naturalWidth : dims.width,
    height: naturalHeight && naturalHeight > 0 ? naturalHeight : dims.height,
  };
  const selectionBadges = (selectionMarkers ?? []).map((marker) => (
    <div
      key={marker.id}
      aria-hidden="true"
      className="pointer-events-none absolute z-20 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-stone-900/85 text-[10px] font-semibold leading-none text-white shadow"
      style={{
        left: `${(marker.x / markerSpace.width) * 100}%`,
        top: `${(marker.y / markerSpace.height) * 100}%`,
      }}
    >
      {marker.index}
    </div>
  ));

  // Brush cursor indicator is a DOM overlay, never canvas pixels, so the
  // exported mask stays clean. Positioned/sized as percentages of the canvas
  // box so it matches the display size in both overlay and standalone modes.
  const cursorIndicator =
    isCanvasFocused && cursor ? (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute z-10 rounded-full border-2 border-white ${
          isKeyboardPainting ? "bg-white/40" : ""
        }`}
        style={{
          left: `${(cursor.x / dims.width) * 100}%`,
          top: `${(cursor.y / dims.height) * 100}%`,
          width: `${(brushSize / dims.width) * 100}%`,
          height: `${(brushSize / dims.height) * 100}%`,
          transform: "translate(-50%, -50%)",
          boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.6)",
        }}
      />
    ) : null;

  // Issue #202: while a segment request is in flight the canvas cursor
  // switches to wait — the click registered and processing is happening.
  const cursorClass = segmenting
    ? "cursor-wait"
    : activeTool === "fill"
      ? "cursor-cell"
      : "cursor-crosshair";

  const canvasAriaLabel =
    activeTool === "fill"
      ? "Room mask canvas with the Fill Region tool active: draw a continuous outline around the object, arrow keys move the cursor, press P, Space, or Enter to fill the region under the cursor"
      : activeTool === "select"
        ? "Room mask canvas with the Select Objects tool active: detected instances show as faint tinted shapes with colored outlines, selected instances as solid fills — click one to toggle its shape in or out of the mask (clicks are free — detection already ran per concept), arrow keys move the cursor, press P, Space, or Enter to toggle the instance under the cursor"
        : "Room mask painting canvas: arrow keys move the brush (hold Shift for fine steps), press P, Space, or Enter to start and stop painting";

  const canvasElement = (
    <div
      role="application"
      className={hasOverlay ? "absolute inset-0" : "relative w-fit"}
    >
      {/* Issue #228: tinted per-instance overlays (score-ranked). Decorative
          layer beneath the interactive mask canvas — never export pixels. */}
      <canvas
        ref={overlayCanvasRef}
        width={dims.width}
        height={dims.height}
        aria-hidden="true"
        className={
          hasOverlay
            ? "pointer-events-none absolute inset-0 h-full w-full"
            : "pointer-events-none absolute left-0 top-0"
        }
        style={
          hasOverlay
            ? undefined
            : { width: Math.min(dims.width, 512), height: Math.min(dims.height, 512) }
        }
      />
      <canvas
        ref={canvasRef}
        width={backing.width}
        height={backing.height}
        tabIndex={0}
        aria-label={canvasAriaLabel}
        aria-describedby={`${maskingHintId} ${hintId}`}
        className={
          hasOverlay
            ? `absolute inset-0 h-full w-full rounded-lg ${cursorClass} touch-none opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-2`
            : `border border-gray-300 rounded ${cursorClass} touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-2`
        }
        style={
          hasOverlay ? undefined : { width: Math.min(dims.width, 512), height: Math.min(dims.height, 512) }
        }
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        onKeyDown={handleCanvasKeyDown}
        onFocus={handleCanvasFocus}
        onBlur={handleCanvasBlur}
      />
      {cursorIndicator}
      {selectionBadges}

      {/* Empty-state hint: the mask uses cover-the-object semantics, so make
          the first paint action obvious. Hidden once anything is painted. */}
      {!hasPainted && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
        >
          <span
            className={`rounded-md bg-black/60 px-3 py-1.5 text-center text-xs font-medium text-white ${
              hasOverlay ? "" : "border border-white/30"
            }`}
          >
            {activeTool === "select"
              ? "Click a tinted object to toggle it in the mask"
              : "Drag to paint over the object you want changed"}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={
        fullWidth
          ? "flex w-full flex-col gap-4"
          : "flex w-fit max-w-full flex-col gap-4"
      }
    >
      {hasOverlay ? (
        <div
          className={
            fullWidth
              ? "relative w-full min-h-48"
              : "relative w-full max-w-md min-h-48"
          }
          style={
            aspectRatio && aspectRatio > 0
              ? { aspectRatio: `${dims.width} / ${dims.height}` }
              : undefined
          }
        >
          {/* The mask paints over the exact intrinsic image, so the editor
              needs a plain <img> (sometimes with no src); next/image's
              optimizer and wrapper would change the request path and DOM
              in this pixel-stacked surface. The LCP heuristic behind
              no-img-element does not apply here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={overlayImageSrc || undefined}
            alt="Original"
            className="absolute inset-0 h-full w-full rounded-lg border border-gray-300"
            loading="lazy"
            decoding="async"
          />
          {canvasElement}
        </div>
      ) : (
        <div className="relative w-fit">{canvasElement}</div>
      )}

      {/* Cover-vs-outline semantics: the mask is region replacement, not
          selection — everything painted is regenerated. */}
      <p id={maskingHintId} className="text-xs text-stone-700">
        <span className="font-medium">How masking works:</span> Paint over the
        entire object or area you want changed — everything painted is
        regenerated, everything else is preserved. A thin outline won&apos;t
        change the interior, so cover the whole object (or draw an outline and
        use Fill Region on its inside).
        {/* Select Objects is flag-gated (SAM_TOOL_ENABLED): the sentence
            disappears with the tool if the kill switch is flipped off. */}
        {SAM_TOOL_ENABLED &&
          " Select Objects detects every instance of the chosen concept in one call — pick a concept chip above, then click outlined objects to add them to the mask (outlines turn solid fills when selected). Re-clicks and re-toggles are free."}
      </p>

      {lowCoverage && (
        <p role="status" className="text-xs font-medium text-amber-700">
          The painted area is very small — this may be a stray stroke or just
          an outline. Paint over the entire object you want changed, then apply
          inpainting.
        </p>
      )}

      <p id={hintId} className="text-xs text-gray-500">
        Keyboard painting: Tab to the canvas, move the brush with the arrow keys
        (Shift + arrow for fine steps), and press P, Space, or Enter to start or
        stop painting. Brush Size and Clear Mask follow in the tab order.
      </p>

      <div className="flex items-center gap-4">
        <div role="group" aria-label="Mask tool" className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={activeTool === "brush"}
            onClick={() => setActiveTool("brush")}
            className={
              activeTool === "brush"
                ? "px-3 py-1.5 text-sm rounded-md border border-stone-800 bg-stone-800 text-white hover:bg-stone-700 transition-colors"
                : "px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
            }
          >
            Brush
          </button>
          <button
            type="button"
            aria-pressed={activeTool === "fill"}
            onClick={() => setActiveTool("fill")}
            className={
              activeTool === "fill"
                ? "px-3 py-1.5 text-sm rounded-md border border-stone-800 bg-stone-800 text-white hover:bg-stone-700 transition-colors"
                : "px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
            }
          >
            Fill Region
          </button>
          {/* Issue #228: the old per-click Select Object tool became the
              concept-driven Select Objects tool. The spinner below is THE
              processing indicator — visible on the tool itself while a
              concept detection runs, not just in the editor's status line. */}
          {SAM_TOOL_ENABLED && (
            <button
              type="button"
              aria-pressed={activeTool === "select"}
              aria-busy={segmenting}
              disabled={segmentDisabled}
              onClick={() => setActiveTool("select")}
              className={
                activeTool === "select"
                  ? "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-stone-800 bg-stone-800 text-white hover:bg-stone-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  : "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              }
            >
              {segmenting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Selecting...
                </>
              ) : (
                "Select Objects"
              )}
            </button>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          Brush Size:
          <input
            type="range"
            min={1}
            max={100}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-32"
          />
          <span className="w-8 text-right">{brushSize}</span>
        </label>

        <button
          onClick={clearMask}
          className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
        >
          Clear Mask
        </button>
      </div>

      <input type="hidden" value={maskDataUrl ?? ""} />
    </div>
  );
}

export function useMaskState() {
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  return { maskDataUrl, setMaskDataUrl };
}
