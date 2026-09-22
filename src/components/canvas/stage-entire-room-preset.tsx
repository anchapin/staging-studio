"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import {
  isFurnishingCoverageAdequate,
} from "@/lib/furnishing-detection";
import {
  HOLISTIC_PRESET_LABEL,
  resolveHolisticPreset,
} from "@/lib/holistic-preset";
import { estimateMaskCoverage } from "@/lib/mask-coverage";
import { paintMaskPixels } from "@/lib/mask-format";
import { maskGridFromPixels } from "@/lib/mask-flood-fill";
import {
  DEFAULT_MASK_EXPANSION_RADIUS,
  dilateMaskGrid,
} from "@/lib/mask-dilation";
import { fillHoles } from "@/lib/mask-postprocess";
import { unionMaskBuffers } from "@/lib/multi-select-batch";

/**
 * The one-click "Restage furnishings" preset (issues #191 and #223): the
 * regeneration mask is the DILATED UNION of per-object masks detected
 * over the room's furnishings (fal-ai/sam-3-1 via
 * `POST /api/segment/furnishings`), so walls, flooring, windows, trim,
 * doors, and ceiling sit outside the regen target and are preserved by
 * construction — the fix for the wall-band preset's architecture drift.
 *
 * Per the #190/#223 contract, endpoint choice, payload, and response
 * parsing stay in `src/lib/furnishing-detection.ts`; prompt wording and
 * plan resolution stay in `holistic-prompt.ts` / `holistic-preset.ts`.
 * This component is UX + browser-only wiring: it converts each detected
 * mask into the white-on-black buffer the mask pipeline classifies —
 * detecting the provider format (grayscale vs alpha cutout, issue #248)
 * via the shared classifier — unions
 * them, dilates by the brush flow's default expansion radius so contact
 * shadows and rims regenerate too, guards the union's coverage, and
 * hands the serialized mask to the parent's shared run launcher.
 */

/** Resolves when the image is loaded; rejects on a load error. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load."));
    img.src = src;
  });
}

/** Serializes a generated mask buffer to the data:image PNG the route expects. */
function maskImageToDataUrl(mask: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(mask.data), mask.width, mask.height),
    0,
    0
  );
  return canvas.toDataURL("image/png");
}

/**
 * Converts one detected provider mask (grayscale or alpha-cutout — the
 * shared classifier detects the format, issue #248) into a white-on-black
 * RGBA buffer at the photo's natural pixel dimensions, rebuilding alpha
 * from the classification instead of trusting the decode's alpha channel.
 */
async function cutoutToWhiteMaskBuffer(
  maskDataUrl: string,
  width: number,
  height: number
): Promise<Uint8ClampedArray | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(await loadImage(maskDataUrl), 0, 0, width, height);
  } catch {
    return null;
  }
  const painted = paintMaskPixels(ctx.getImageData(0, 0, width, height).data, width, height, {
    maskedColor: [255, 255, 255],
  });
  return new Uint8ClampedArray(painted);
}

interface StageEntireRoomPresetProps {
  /** The room being edited (scopes the detection call server-side). */
  roomId: string;
  /** The resolved source image the detection call segments. */
  imageUrl: string;
  /** The room's project `stagingAesthetic` (may be empty). */
  aesthetic: string;
  /** Natural pixel width of the current source photo (mask builds at this size). */
  imageWidth: number | null;
  /** Natural pixel height of the current source photo. */
  imageHeight: number | null;
  /** True while another editor interaction (segmenting) blocks new runs. */
  disabled: boolean;
  /** True while a run is in flight (fal queue poll) — processing feedback. */
  processing: boolean;
  /** Queue-poll progress text from the editor's shared status hook. */
  statusText?: string | null;
  onRun: (run: {
    maskDataUrl: string;
    promptDirectives: string;
    negativePrompt: string;
  }) => void;
  onError: (message: string) => void;
}

export default function StageEntireRoomPreset({
  roomId,
  imageUrl,
  aesthetic,
  imageWidth,
  imageHeight,
  disabled,
  processing,
  statusText,
  onRun,
  onError,
}: StageEntireRoomPresetProps) {
  const plan = useMemo(() => resolveHolisticPreset({ aesthetic }), [aesthetic]);
  const [detecting, setDetecting] = useState(false);

  const handleRun = useCallback(async () => {
    if (!imageWidth || !imageHeight) {
      onError("The image is still loading. Please try again.");
      return;
    }
    if (detecting) return;
    setDetecting(true);
    try {
      // 1. Detect furnishings via the generalized concept endpoint with the
      //    explicit "furniture" concept (issue #239: the preset now calls the
      //    same pathway as the concept prewarm hook instead of relying on the
      //    omitted-concept default).
      const response = await fetch("/api/segment/furnishings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, imageUrl, concept: "furniture" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.message || data?.error || "Furnishings detection failed."
        );
      }
      const maskDataUrls: string[] = Array.isArray(data?.maskDataUrls)
        ? data.maskDataUrls
        : [];
      if (maskDataUrls.length === 0) {
        throw new Error(
          "No furnishings were detected in this photo. Use the brush tools to mask the room manually."
        );
      }

      // 2. Convert provider masks to white-on-black buffers at natural dims.
      const buffers: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [];
      for (const url of maskDataUrls) {
        const data_ = await cutoutToWhiteMaskBuffer(url, imageWidth, imageHeight);
        if (data_) buffers.push({ width: imageWidth, height: imageHeight, data: data_ });
      }

      // 3. Union the objects, then dilate so contact shadows, bezels, and
      //    rims at each object's boundary regenerate too (same knob and
      //    rationale as the brush flow's Mask Expansion default).
      const union = unionMaskBuffers(buffers);
      if (!union) {
        throw new Error("Could not build the furnishings mask. Please try again.");
      }
      const grid = maskGridFromPixels(union.data, imageWidth, imageHeight);
      const dilated = dilateMaskGrid(
        grid,
        imageWidth,
        imageHeight,
        DEFAULT_MASK_EXPANSION_RADIUS
      );
      if (!dilated) {
        throw new Error("Could not build the furnishings mask. Please try again.");
      }
      // Issue #252 D3: filling runs last — dilation can seal enclosed
      // pockets, so the dispatched furnishings mask is always hole-free.
      const filled = fillHoles(dilated.mask, imageWidth, imageHeight);
      const finalMask = filled ? filled.mask : dilated.mask;
      const maskData = new Uint8ClampedArray(imageWidth * imageHeight * 4);
      for (let i = 0; i < finalMask.length; i++) {
        const o = i * 4;
        if (finalMask[i] === 1) {
          maskData[o] = 255;
          maskData[o + 1] = 255;
          maskData[o + 2] = 255;
        }
        maskData[o + 3] = 255;
      }

      // 4. Coverage guard: a near-empty union means a degenerate
      //    detection — fail visibly instead of submitting a meaningless
      //    mask. Architecture preservation itself is structural: those
      //    pixels never entered the union.
      const coverage = estimateMaskCoverage(maskData, imageWidth, imageHeight);
      if (!isFurnishingCoverageAdequate(coverage)) {
        throw new Error(
          "Too little of the photo was detected as furnishings. Use the brush tools to mask the room manually."
        );
      }

      // 5. Serialize and dispatch through the shared run launcher.
      const maskDataUrl = maskImageToDataUrl({
        width: imageWidth,
        height: imageHeight,
        data: maskData,
      });
      if (!maskDataUrl) {
        throw new Error("Could not serialize the furnishings mask. Please try again.");
      }
      onRun({
        maskDataUrl,
        promptDirectives: plan.directives,
        negativePrompt: plan.negativePrompt,
      });
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "The furnishings preset failed. Please use the brush flow."
      );
    } finally {
      setDetecting(false);
    }
  }, [roomId, imageUrl, imageWidth, imageHeight, detecting, plan, onRun, onError]);

  const buttonDisabled = disabled || detecting;

  return (
    <section
      aria-label="Restage furnishings preset"
      className="no-print flex flex-col gap-3 rounded-md border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-stone-800">
          {HOLISTIC_PRESET_LABEL}
          <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-600">
            optional shortcut
          </span>
        </h4>
        <p className="mt-1 text-xs text-stone-600">
          Detects furniture and decor and restages them to match the
          &ldquo;{plan.aesthetic}&rdquo; brief
          {plan.usingFallbackAesthetic
            ? " (no aesthetic set — using a neutral brief)"
            : ""}
          . Walls, flooring, and windows stay as photographed. You can also
          paint a mask on the photo below and apply inpainting directly —
          no shortcut needed.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {(processing || detecting) && statusText && (
          <span role="status" className="text-xs text-stone-600">
            {statusText}
          </span>
        )}
        <button
          type="button"
          onClick={handleRun}
          disabled={buttonDisabled}
          aria-busy={processing || detecting}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
            transition-colors
            ${buttonDisabled
              ? "bg-stone-100 text-stone-400 cursor-not-allowed border border-stone-200"
              : "border border-stone-300 bg-white font-jakarta text-stone-700 hover:bg-stone-50"
            }
          `}
        >
          {processing || detecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              {detecting ? "Detecting furnishings..." : "Restaging furnishings..."}
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              {HOLISTIC_PRESET_LABEL}
            </>
          )}
        </button>
      </div>
    </section>
  );
}
