/**
 * One-click "Restage furnishings" preset plan (issues #191 and #223).
 *
 * Pure resolution layer for the preset in the staging editor. Issue
 * #223 replaced the geometric mask strategy (the wall-band band between
 * preserved ceiling/floor strips) with a furnishings-detection mask: the
 * regen target is the union of per-object masks over detected furniture
 * and decor, so walls, flooring, windows, trim, doors, and ceiling sit
 * OUTSIDE the mask and are preserved by construction instead of by
 * prompt wording. The detection call itself (fal-ai/sam-3-1/image) and
 * the union composition live in `furnishing-detection.ts` and the
 * preset component; this module resolves only which mask kind, which
 * prompt wording, and which aesthetic the run uses.
 *
 * Empty/whitespace aesthetics fall back to a neutral brief so the
 * preset never dead-ends (issue #191) and the request still satisfies
 * the inpaint route's `aesthetic` (1–200 chars) bound, which an empty
 * string would fail.
 *
 * The geometric strategies remain available to the #190 spike panel via
 * `HOLISTIC_MASK_STRATEGIES` in `holistic-mask.ts` — they are no longer
 * part of the preset.
 *
 * Pure logic only; side effects: none.
 */

import {
  HOLISTIC_NEGATIVE_PROMPT,
  buildHolisticDirectives,
  type HolisticPromptVariantId,
} from "./holistic-prompt";

/** Button label for the one-click preset. Issue #223 renamed the preset
 * from "Stage entire room": the flow restages furnishings and decor, so
 * the label must not promise whole-photo restaging. */
export const HOLISTIC_PRESET_LABEL = "Restage furnishings";

/**
 * Prompt wording the preset ships with: the architecture-first (a2)
 * variant, strengthened for the furnishings scope (decluttering plus
 * do-not-alter-architecture language).
 */
export const HOLISTIC_PRESET_PROMPT_VARIANT: HolisticPromptVariantId =
  "architecture-first";

/** Neutral brief used when the project has no stagingAesthetic set. */
export const HOLISTIC_PRESET_FALLBACK_AESTHETIC =
  "tasteful, broadly appealing";

/**
 * Resolves the effective aesthetic for a preset run: the project's
 * `stagingAesthetic` when non-empty (trimmed), otherwise the neutral
 * fallback brief. Side effects: none (pure).
 */
export function effectiveHolisticPresetAesthetic(
  aesthetic: string | null | undefined
): { aesthetic: string; usingFallback: boolean } {
  const trimmed = aesthetic?.trim() ?? "";
  if (trimmed) return { aesthetic: trimmed, usingFallback: false };
  return { aesthetic: HOLISTIC_PRESET_FALLBACK_AESTHETIC, usingFallback: true };
}

/** How the preset run's regeneration mask is built (issue #223). */
export type HolisticPresetMaskKind = "furnishings-detection";

/** Everything a preset run needs, resolved from the project aesthetic. */
export interface HolisticPresetPlan {
  /** How the component builds the mask (see `furnishing-detection.ts`). */
  maskKind: HolisticPresetMaskKind;
  promptVariant: HolisticPromptVariantId;
  /** Effective aesthetic after fallback resolution (never empty). */
  aesthetic: string;
  usingFallbackAesthetic: boolean;
  /** The `promptDirectives` payload for POST /api/inpaint. */
  directives: string;
  /** The holistic-scoped `negativePrompt` payload. */
  negativePrompt: string;
}

/**
 * Resolves the full preset plan for a project aesthetic. Side effects:
 * none (pure).
 */
export function resolveHolisticPreset(input: {
  aesthetic?: string | null;
}): HolisticPresetPlan {
  const { aesthetic, usingFallback } = effectiveHolisticPresetAesthetic(
    input.aesthetic
  );

  return {
    maskKind: "furnishings-detection",
    promptVariant: HOLISTIC_PRESET_PROMPT_VARIANT,
    aesthetic,
    usingFallbackAesthetic: usingFallback,
    directives: buildHolisticDirectives({
      aesthetic,
      variant: HOLISTIC_PRESET_PROMPT_VARIANT,
    }),
    negativePrompt: HOLISTIC_NEGATIVE_PROMPT,
  };
}
