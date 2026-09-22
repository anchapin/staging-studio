"use client";

import { useCallback, useId, useState } from "react";
import {
  DEFAULT_HOLISTIC_MASK_STRATEGY_ID,
  HOLISTIC_MASK_STRATEGIES,
  getHolisticMaskStrategy,
  type HolisticMaskImage,
  type HolisticMaskStrategyId,
} from "@/lib/holistic-mask";
import {
  HOLISTIC_NEGATIVE_PROMPT,
  buildHolisticDirectives,
  type HolisticPromptVariantId,
} from "@/lib/holistic-prompt";

/**
 * Spike entry point for the holistic "stage the ENTIRE room" flow
 * (issue #190). Deliberately NOT the polished one-click preset — issue
 * #191 owns that UX once the operator's empirical fal.ai verdicts pick
 * the winning strategy. This panel just makes the strategy + prompt
 * template layer runnable end-to-end through the existing inpaint
 * route: it builds the selected full-room mask at the photo's natural
 * pixel dimensions, derives the directives from the room's aesthetic,
 * and hands everything to the parent's run launcher.
 */

/** Issue-#190 wording variants, labeled with the issue's a1/a2 ids. */
const PROMPT_VARIANTS: readonly { id: HolisticPromptVariantId; label: string }[] = [
  { id: "thematic", label: "a1 — thematic directive" },
  { id: "architecture-first", label: "a2 — architecture-first wording" },
];

/** Serializes a generated mask buffer to the data:image PNG the route expects. */
function maskImageToDataUrl(mask: HolisticMaskImage): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // 4-byte copy so the buffer is a plain ArrayBuffer-backed view (ImageData
  // typing) — negligible at photo resolution for a spike panel.
  ctx.putImageData(new ImageData(new Uint8ClampedArray(mask.data), mask.width, mask.height), 0, 0);
  return canvas.toDataURL("image/png");
}

interface HolisticSpikePanelProps {
  aesthetic: string;
  /** Natural pixel width of the current source photo (masks build at this size). */
  imageWidth: number | null;
  /** Natural pixel height of the current source photo. */
  imageHeight: number | null;
  /** True while another run is in flight; disables the controls. */
  disabled: boolean;
  onRun: (run: {
    maskDataUrl: string;
    promptDirectives: string;
    negativePrompt: string;
  }) => void;
  onError: (message: string) => void;
}

export default function HolisticSpikePanel({
  aesthetic,
  imageWidth,
  imageHeight,
  disabled,
  onRun,
  onError,
}: HolisticSpikePanelProps) {
  const [strategyId, setStrategyId] = useState(DEFAULT_HOLISTIC_MASK_STRATEGY_ID);
  const [promptVariant, setPromptVariant] = useState<HolisticPromptVariantId>(
    "architecture-first"
  );
  const strategySelectId = useId();
  const variantSelectId = useId();

  const handleRun = useCallback(() => {
    const strategy = getHolisticMaskStrategy(strategyId);
    if (!strategy || !imageWidth || !imageHeight) {
      onError("The photo is still loading. Please try again.");
      return;
    }
    const mask = strategy.build(imageWidth, imageHeight);
    if (!mask) {
      onError("Could not build the holistic mask for this photo.");
      return;
    }
    const maskDataUrl = maskImageToDataUrl(mask);
    if (!maskDataUrl) {
      onError("Could not serialize the holistic mask.");
      return;
    }
    onRun({
      maskDataUrl,
      promptDirectives: buildHolisticDirectives({ aesthetic, variant: promptVariant }),
      negativePrompt: HOLISTIC_NEGATIVE_PROMPT,
    });
  }, [strategyId, imageWidth, imageHeight, aesthetic, promptVariant, onRun, onError]);

  const isRunDisabled = disabled || !imageWidth || !imageHeight;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-stone-500">
        Issue #190 spike: builds a full-room mask + aesthetic-derived prompt and
        runs it through the normal inpaint flow. The result lands in a variant
        slot; brush touch-ups can then stack on it via the &quot;Edit from&quot;
        selector. Empirical verdicts are recorded in the issue.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-stone-700">
          Mask strategy:
          <select
            id={strategySelectId}
            value={strategyId}
            disabled={disabled}
            onChange={(e) => setStrategyId(e.target.value as HolisticMaskStrategyId)}
            className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm"
          >
            {HOLISTIC_MASK_STRATEGIES.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-stone-700">
          Prompt variant:
          <select
            id={variantSelectId}
            value={promptVariant}
            disabled={disabled}
            onChange={(e) => setPromptVariant(e.target.value as HolisticPromptVariantId)}
            className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm"
          >
            {PROMPT_VARIANTS.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.label}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={handleRun}
          disabled={isRunDisabled}
          className={`
            px-3 py-1.5 rounded-md text-sm font-medium transition-colors
            ${isRunDisabled
              ? "bg-stone-200 text-stone-400 cursor-not-allowed"
              : "bg-stone-700 text-white hover:bg-stone-600"
            }
          `}
        >
          Run holistic staging
        </button>
      </div>

      <p className="text-xs text-stone-500">
        {getHolisticMaskStrategy(strategyId)?.description}
      </p>
    </div>
  );
}
