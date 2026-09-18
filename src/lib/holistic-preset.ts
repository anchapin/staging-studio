/**
 * One-click "Stage entire room" preset plan (issue #191).
 *
 * Pure resolution layer for the polished preset in the staging editor:
 * it pins the mask strategy to the spike's pre-registered winner
 * ({@link DEFAULT_HOLISTIC_MASK_STRATEGY_ID} in `holistic-mask.ts`) and
 * the prompt wording to the architecture-first variant (a2 — the spike's
 * architecture-preservation + TV-removal wording, per the #190
 * protocol), then derives the directives from the project's
 * `stagingAesthetic`.
 *
 * Empty/whitespace aesthetics fall back to a neutral brief so the
 * preset never dead-ends (issue #191) and the request still satisfies
 * the inpaint route's `aesthetic` (1–200 chars) bound, which an empty
 * string would fail.
 *
 * Strategy + prompt composition stay in the #190 lib modules — this
 * module is only preset-level resolution (which strategy, which
 * wording, which aesthetic). The browser-only mask→PNG serialization
 * and the run dispatch live in the preset component. Pure logic only;
 * side effects: none.
 */

import {
  DEFAULT_HOLISTIC_MASK_STRATEGY_ID,
  getHolisticMaskStrategy,
  type HolisticMaskStrategy,
} from "./holistic-mask";
import {
  HOLISTIC_NEGATIVE_PROMPT,
  buildHolisticDirectives,
  type HolisticPromptVariantId,
} from "./holistic-prompt";

/** Button label for the one-click preset. */
export const HOLISTIC_PRESET_LABEL = "Stage entire room";

/**
 * Prompt wording the preset ships with: the architecture-first (a2)
 * variant. If the #190 verdict ever prefers the thematic wording as the
 * one-click default, this constant is the single flip point (the
 * strategy's flip point is `DEFAULT_HOLISTIC_MASK_STRATEGY_ID`).
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

/** Everything a preset run needs, resolved from the project aesthetic. */
export interface HolisticPresetPlan {
  strategy: HolisticMaskStrategy;
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
 * Resolves the full preset plan for a project aesthetic; `null` only
 * for an unknown strategy id (defensive — the default id is a
 * compile-time constant). Side effects: none (pure).
 */
export function resolveHolisticPreset(input: {
  aesthetic?: string | null;
  strategyId?: string;
}): HolisticPresetPlan | null {
  const strategy = getHolisticMaskStrategy(
    input.strategyId ?? DEFAULT_HOLISTIC_MASK_STRATEGY_ID
  );
  if (!strategy) return null;

  const { aesthetic, usingFallback } = effectiveHolisticPresetAesthetic(
    input.aesthetic
  );

  return {
    strategy,
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
