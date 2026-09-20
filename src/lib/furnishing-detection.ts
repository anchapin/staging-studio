/**
 * SAM 3.1 furnishings detection helpers (issue #223, Problem 1).
 *
 * The one-click preset's regeneration target is built from segmented
 * furnishings instead of a geometric region: walls, flooring, windows,
 * trim, doors, and ceiling sit OUTSIDE the mask and are preserved by
 * construction, not by prompt wording (the wall-band strategy's
 * prompt-only preservation is what drifted architecture in the field
 * report).
 *
 * Endpoint contract (verified against the live queue, issue #223 spike):
 * - `fal-ai/sam-3-1/image` takes a text `prompt` and returns one mask per
 *   detected object in `masks` (plus `image`, a preview of the first
 *   mask).
 * - The winning prompt is the single concept "furniture": the probe photo
 *   returned 9 per-object masks (scores 0.50–0.94). Multi-term comma
 *   lists ("furniture, sofa, rug, …") returned ZERO masks, and the
 *   sentence "all furniture and decor in the room" returned one weak
 *   mask (score 0.52) — so the prompt stays a bare concept.
 * - Each returned mask is an RGBA alpha-cutout PNG at the source image's
 *   pixel dimensions: transparent background, opaque photo-colored
 *   object pixels. The browser compositing step converts cutouts to the
 *   white-on-black buffers the inpaint mask pipeline classifies
 *   (see `mask-coverage.ts`).
 *
 * This module keeps the endpoint choice, request payload shape, and
 * response parsing as pure logic (the same deep-module shape as
 * `segment-mask.ts`) so the endpoint can be re-spiked without touching
 * route or component code.
 */

/** fal.ai SAM 3.1 image endpoint used for text-prompted furnishings detection. */
export const FAL_FURNISHING_DETECTION_MODEL = "fal-ai/sam-3-1/image";

/**
 * The default detection prompt: a bare "furniture" concept. Empirically
 * confirmed (issue #223 spike probe) — see the module doc for why
 * multi-term lists are counterproductive. Since issue #227 this is the
 * DEFAULT concept, not a hardcode: callers may pass any single lowercase
 * concept ("sofa", "wall art", …) through the payload builder, and the
 * preset path that omits `concept` keeps this byte-equivalent behavior.
 */
export const FURNISHING_DETECTION_PROMPT = "furniture";

/** Upper bound on per-object masks requested from one detection call. */
export const FURNISHING_DETECTION_MAX_MASKS = 30;

/**
 * Minimum fraction of the frame the union mask must cover for a preset
 * run to proceed. Matches `mask-coverage.ts`'s
 * `LOW_COVERAGE_WARNING_THRESHOLD` (0.5%): a union below it is far more
 * likely a degenerate detection (one tiny object) than a genuinely
 * furnished room, and the preset fails visibly instead of submitting a
 * meaningless mask.
 */
export const FURNISHING_DETECTION_MIN_COVERAGE_RATIO = 0.005;

/**
 * True when a detection union's coverage (from `estimateMaskCoverage`)
 * is meaningful enough to restage. Side effects: none (pure).
 */
export function isFurnishingCoverageAdequate(coverage: number): boolean {
  return Number.isFinite(coverage) && coverage >= FURNISHING_DETECTION_MIN_COVERAGE_RATIO;
}

// Type alias (not interface) so the payload stays assignable to the
// `Record<string, unknown>` input type of `fal.subscribe` — same pattern
// as `FalSegmentPayload` in lib/segment-mask.ts.
export type FalFurnishingDetectionPayload = {
  image_url: string;
  /** Text concept the segmenter detects; see {@link FURNISHING_DETECTION_PROMPT}. */
  prompt: string;
  /** Return raw masks, not an applied-mask preview of the photo. */
  apply_mask: false;
  /** One mask per detected object instead of only the best match. */
  return_multiple_masks: true;
  max_masks: number;
  /** Per-mask confidence scores (diagnostics + future score floor). */
  include_scores: boolean;
};

/** Inputs for building a furnishings-detection request. */
export interface FurnishingDetectionPayloadInput {
  /** Source image URL fal will fetch and segment. */
  imageUrl: string;
  /**
   * Optional SAM 3.1 detection concept (issue #227): a single lowercase
   * word or short phrase ("sofa", "wall art"). Omitted ⇒ the verified
   * {@link FURNISHING_DETECTION_PROMPT} default, keeping the one-click
   * preset path byte-equivalent.
   */
  concept?: string;
}

/**
 * Builds the `input` payload for the fal.ai SAM 3.1 detection call in
 * `api/segment/furnishings`.
 *
 * Contract: the image URL passes through unchanged (validation happens
 * in the route's zod schema); every flag is pinned so the returned masks
 * match the union-builder's expectations (per-object alpha cutouts at
 * source dimensions). The concept is the caller-supplied detection
 * prompt, defaulting to {@link FURNISHING_DETECTION_PROMPT} when
 * omitted (issue #227). The exact shape is pinned by
 * `tests/furnishing-detection.test.ts`.
 * Side effects: none (pure).
 */
export function buildFurnishingDetectionPayload(
  input: FurnishingDetectionPayloadInput
): FalFurnishingDetectionPayload {
  return {
    image_url: input.imageUrl,
    prompt: input.concept ?? FURNISHING_DETECTION_PROMPT,
    apply_mask: false,
    return_multiple_masks: true,
    max_masks: FURNISHING_DETECTION_MAX_MASKS,
    include_scores: true,
  };
}

/**
 * Successful detection result: mask image URLs and per-mask confidence
 * scores, one entry per detected object, index-aligned (`scores[i]` is
 * the SAM confidence for `maskUrls[i]`).
 */
export interface FurnishingDetectionResult {
  maskUrls: string[];
  scores: number[];
}

/**
 * Extracts the per-object mask image URLs and confidence scores from a
 * fal.ai SAM 3.1 detection response (issue #227 generalizes #223's
 * URL-only parse; `include_scores: true` is already requested).
 *
 * Contract: the endpoint resolves to `{ masks: [{ url, width, height,
 * ... }, ...], scores: [0.94, ...] }` — top-level `scores` aligns with
 * `masks` by index; individual mask entries may also carry their own
 * `score`. An empty `masks` array is a valid detection that found
 * nothing ("no {concept} found" is a presentable result, not an error);
 * any other shape — missing/non-array `masks`, or entries without a
 * usable URL — returns `null` so the route fails with the classified
 * detection-failure copy instead of a crash. Mask entries lacking a URL
 * are skipped rather than failing the whole parse, and a kept mask with
 * no resolvable finite score (entry-level or top-level at its original
 * index) reports 0 — the confidence floor — instead of dropping the
 * detection, so `scores.length === maskUrls.length` always holds.
 * Side effects: none (pure).
 */
export function parseFurnishingDetectionResponse(
  data: unknown
): FurnishingDetectionResult | null {
  if (typeof data !== "object" || data === null) return null;
  const masks = (data as { masks?: unknown }).masks;
  if (!Array.isArray(masks)) return null;
  const topScores = Array.isArray((data as { scores?: unknown }).scores)
    ? ((data as { scores: unknown[] }).scores)
    : [];

  const maskUrls: string[] = [];
  const scores: number[] = [];
  for (let index = 0; index < masks.length; index++) {
    const mask = masks[index];
    if (typeof mask !== "object" || mask === null) continue;
    const url = (mask as { url?: unknown }).url;
    if (typeof url !== "string" || url.trim() === "") continue;
    maskUrls.push(url);

    const entryScore = (mask as { score?: unknown }).score;
    const topScore = topScores[index];
    const score =
      typeof entryScore === "number" && Number.isFinite(entryScore)
        ? entryScore
        : typeof topScore === "number" && Number.isFinite(topScore)
          ? topScore
          : 0;
    scores.push(score);
  }
  return { maskUrls, scores };
}
