"use client";

import { useCallback, useMemo } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { HolisticMaskImage } from "@/lib/holistic-mask";
import {
  HOLISTIC_PRESET_LABEL,
  resolveHolisticPreset,
} from "@/lib/holistic-preset";

/**
 * The polished one-click "Stage entire room" preset (issue #191): the
 * spike-confirmed full-room mask strategy plus the aesthetic-derived
 * prompt in a single primary editor control, targeting the currently
 * selected variant slot so brush touch-ups stack on the result via the
 * existing progressive inpainting flow.
 *
 * Per the #190 contract, strategy + prompt composition stay in the
 * src/lib modules (`holistic-mask.ts`, `holistic-prompt.ts`,
 * `holistic-preset.ts`) — this component is UX + wiring only: it builds
 * the strategy mask at the photo's natural pixel dimensions, serializes
 * it to the data:image PNG the route expects, and hands everything to
 * the parent's shared run launcher. It does NOT depend on the #190
 * spike panel (which stays as protocol documentation).
 */

/** Serializes a generated mask buffer to the data:image PNG the route expects. */
function maskImageToDataUrl(mask: HolisticMaskImage): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // 4-byte copy so the buffer is a plain ArrayBuffer-backed view (ImageData
  // typing) — same pattern as the #190 spike panel.
  ctx.putImageData(new ImageData(new Uint8ClampedArray(mask.data), mask.width, mask.height), 0, 0);
  return canvas.toDataURL("image/png");
}

interface StageEntireRoomPresetProps {
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

  const handleRun = useCallback(() => {
    if (!plan) {
      onError("The full-room preset is unavailable. Please use the brush flow.");
      return;
    }
    if (!imageWidth || !imageHeight) {
      onError("The image is still loading. Please try again.");
      return;
    }
    const mask = plan.strategy.build(imageWidth, imageHeight);
    if (!mask) {
      onError("Could not build the full-room mask. Please try again.");
      return;
    }
    const maskDataUrl = maskImageToDataUrl(mask);
    if (!maskDataUrl) {
      onError("Could not serialize the full-room mask. Please try again.");
      return;
    }
    onRun({
      maskDataUrl,
      promptDirectives: plan.directives,
      negativePrompt: plan.negativePrompt,
    });
  }, [plan, imageWidth, imageHeight, onRun, onError]);

  const buttonDisabled = disabled || !plan;

  return (
    <section
      aria-label="Stage entire room preset"
      className="no-print flex flex-col gap-3 rounded-md border border-stone-300 bg-stone-50 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-stone-800">
          {HOLISTIC_PRESET_LABEL}
          {plan && (
            <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs font-normal text-stone-600">
              {plan.strategy.label}
            </span>
          )}
        </h4>
        <p className="mt-1 text-xs text-stone-600">
          {plan ? (
            <>
              Restages the whole photo with the &ldquo;{plan.aesthetic}
              &rdquo; brief
              {plan.usingFallbackAesthetic
                ? " (no aesthetic set — using a neutral brief)"
                : ""}
              ; the ceiling line and floor plane stay anchored. Touch up the
              result afterwards with the brush.
            </>
          ) : (
            "Preset unavailable — please use the brush flow."
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {processing && statusText && (
          <span role="status" className="text-xs text-stone-600">
            {statusText}
          </span>
        )}
        <button
          type="button"
          onClick={handleRun}
          disabled={buttonDisabled}
          aria-busy={processing}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
            transition-colors
            ${buttonDisabled
              ? "bg-stone-300 text-stone-500 cursor-not-allowed"
              : "bg-stone-800 text-white hover:bg-stone-700"
            }
          `}
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Staging...
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
