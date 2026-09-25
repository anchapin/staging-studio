"use client";

import { useEffect, useRef, useState } from "react";
import { extractMaskOutline, paintMaskPixels } from "@/lib/mask-format";
import type { InstanceOverlay } from "@/lib/instance-overlays";
import type { CopiedMaskRegion } from "./inpaint-mask-canvas";

/**
 * Issue #549: Atelier Canvas spec mask overlay colors (extracted from
 * inpaint-mask-canvas.tsx by #691).
 */
export const MASK_OVERLAY_EMERALD = "rgba(0, 245, 160, 0.35)";
export const MASK_OVERLAY_AMBER = "rgba(255, 184, 0, 0.38)";

/**
 * Issue #549: Laser-rim border for mask visibility.
 * 1px solid border ensuring the mask overlay is visible over varied surfaces.
 */
export const MASK_LASER_RIM_BORDER = "1px solid rgba(0, 245, 160, 0.8)";

/**
 * Issue #549: Rank→color palette for instance overlays (issue #228). Six
 * hues, cycled by score rank, so adjacent instances stay distinguishable.
 * RGB tuples feed `paintMaskPixels` directly (issue #248). Exported since
 * issue #252 so the batch panel's number chips can carry the SAME color
 * as a region's canvas tint (D4: tint and chip double-encode the mapping).
 */
export const INSTANCE_OVERLAY_PALETTE: Array<readonly [number, number, number]> = [
  [0x22, 0xc5, 0x5f],
  [0xf9, 0x73, 0x16],
  [0x3b, 0x82, 0xf6],
  [0xa8, 0x55, 0xf7],
  [0x06, 0xb6, 0xd4],
  [0xea, 0xb3, 0x08],
];

/** CSS color for palette slot `index` (cycles), shared with the panel chips. */
export function paletteCssColor(index: number): string {
  const [r, g, b] = INSTANCE_OVERLAY_PALETTE[((index % INSTANCE_OVERLAY_PALETTE.length) + INSTANCE_OVERLAY_PALETTE.length) % INSTANCE_OVERLAY_PALETTE.length];
  return `rgb(${r} ${g} ${b})`;
}

/**
 * Issue #249: detected-only vs selected must be distinguishable at a
 * glance. A detected-only instance renders as a FAINT rank-colored wash
 * plus a crisp rank-colored outline; a selected one renders as a solid
 * rank-colored fill.
 */
const DETECTED_WASH_ALPHA = 0.15;
const SELECTED_FILL_ALPHA = 0.45;

/**
 * Draws the tinted instance overlays onto `ctx` (verbatim draw loop from
 * inpaint-mask-canvas.tsx — both overlay effects run the same loop).
 */
function drawInstanceOverlays(
  ctx: CanvasRenderingContext2D,
  instanceOverlays: InstanceOverlay[],
  cache: Map<string, HTMLImageElement>,
  dims: { width: number; height: number }
) {
  for (const overlay of instanceOverlays) {
    const img = cache.get(overlay.maskDataUrl);
    if (!img || !img.complete || !img.naturalWidth) continue;
    const paletteColor = INSTANCE_OVERLAY_PALETTE[
      (overlay.selected && overlay.colorIndex !== undefined
        ? overlay.colorIndex
        : overlay.rank) % INSTANCE_OVERLAY_PALETTE.length
    ];
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
}

export interface UseMaskOverlayLayerInput {
  dims: { width: number; height: number };
  instanceOverlays?: InstanceOverlay[];
}

/**
 * The mask canvas's decorative overlay layer (issue #691 extraction from
 * inpaint-mask-canvas.tsx): score-ranked instance tints (#228/#249/
 * #252 D4), the #591 copy-paste selection rectangle, and the paste
 * preview — all drawn on a dedicated canvas below the interactive mask
 * canvas. Never touches the exported mask pixels.
 */
export function useMaskOverlayLayer({ dims, instanceOverlays }: UseMaskOverlayLayerInput) {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const instanceImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [overlayTick, setOverlayTick] = useState(0);

  // Issue #591: copy-paste mask state
  const [copiedMask, setCopiedMask] = useState<CopiedMaskRegion | null>(null);
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [pastePreview, setPastePreview] = useState<{ x: number; y: number; mirrored: boolean } | null>(null);

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

  // ---------------------------------------------------------------------
  // Issue #228: score-ranked instance overlays. A dedicated canvas layer
  // (below the interactive mask canvas) tints each detected instance by
  // rank; since issue #249 selected instances render as a solid fill
  // (their pixels already show as white in the mask canvas above) while
  // detected-only ones stay a faint wash plus an outline. This layer is
  // decorative only — it never touches the exported mask pixels.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = overlayCanvas?.getContext("2d");
    if (!overlayCanvas || !ctx) return;
    ctx.clearRect(0, 0, dims.width, dims.height);
    if (!instanceOverlays || instanceOverlays.length === 0) return;
    const cache = instanceImageCacheRef.current;
    drawInstanceOverlays(ctx, instanceOverlays, cache, { width: dims.width, height: dims.height });
    ctx.globalAlpha = 1;
  }, [instanceOverlays, overlayTick, dims.width, dims.height]);

  // Issue #591: render the copy-paste selection rectangle and paste preview
  // on the overlay canvas (above instance overlays, below the interactive canvas).
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    const ctx = overlayCanvas?.getContext("2d");
    if (!overlayCanvas || !ctx) return;
    // Always clear first — we redraw the full overlay stack on every change
    ctx.clearRect(0, 0, dims.width, dims.height);

    // Re-draw instance overlays so the selection/preview sits above them
    const cache = instanceImageCacheRef.current;
    if (instanceOverlays && instanceOverlays.length > 0) {
      drawInstanceOverlays(ctx, instanceOverlays, cache, { width: dims.width, height: dims.height });
    }

    // Issue #591: paste preview — draw the copied mask region at the cursor
    // position as a faint preview, using a distinct amber tint.
    if (pastePreview && copiedMask) {
      const { imageData, bounds } = copiedMask;
      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = bounds.width;
      previewCanvas.height = bounds.height;
      const previewCtx = previewCanvas.getContext("2d");
      if (previewCtx) {
        previewCtx.putImageData(imageData, 0, 0);
        if (pastePreview.mirrored) {
          ctx.save();
          ctx.translate(pastePreview.x + bounds.width, pastePreview.y);
          ctx.scale(-1, 1);
          ctx.globalAlpha = 0.45;
          ctx.drawImage(previewCanvas, 0, 0);
          ctx.restore();
        } else {
          ctx.globalAlpha = 0.45;
          ctx.drawImage(previewCanvas, pastePreview.x, pastePreview.y);
        }
        // Amber dashed border to indicate preview
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#FFB800";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(pastePreview.x, pastePreview.y, bounds.width, bounds.height);
        ctx.setLineDash([]);
      }
    }

    // Issue #591: selection rectangle — electric cyan dashed border
    if (selectionRect) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(0, 245, 160, 0.08)";
      ctx.fillRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
      ctx.strokeStyle = "#00F5A0";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }, [selectionRect, pastePreview, copiedMask, instanceOverlays, overlayTick, dims.width, dims.height]);

  return {
    overlayCanvasRef,
    copiedMask,
    setCopiedMask,
    selectionRect,
    setSelectionRect,
    pastePreview,
    setPastePreview,
  };
}
