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
 * The detection prompt: a bare "furniture" concept. Empirically confirmed
 * (issue #223 spike probe) — see the module doc for why multi-term lists
 * are counterproductive. Spike iterations that refine detected coverage
 * (e.g. adding a second concept call for artwork/plants) flip this
 * constant or the payload builder, nothing else.
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
}

/**
 * Builds the `input` payload for the fal.ai SAM 3.1 detection call in
 * `api/segment/furnishings`.
 *
 * Contract: the image URL passes through unchanged (validation happens
 * in the route's zod schema); every flag is pinned so the returned masks
 * match the union-builder's expectations (per-object alpha cutouts at
 * source dimensions). The exact shape is pinned by
 * `tests/furnishing-detection.test.ts`.
 * Side effects: none (pure).
 */
export function buildFurnishingDetectionPayload(
  input: FurnishingDetectionPayloadInput
): FalFurnishingDetectionPayload {
  return {
    image_url: input.imageUrl,
    prompt: FURNISHING_DETECTION_PROMPT,
    apply_mask: false,
    return_multiple_masks: true,
    max_masks: FURNISHING_DETECTION_MAX_MASKS,
    include_scores: true,
  };
}

/** Successful detection result: mask image URLs, one per detected object. */
export interface FurnishingDetectionResult {
  maskUrls: string[];
}

/**
 * Extracts the per-object mask image URLs from a fal.ai SAM 3.1
 * detection response.
 *
 * Contract: the endpoint resolves to `{ masks: [{ url, width, height,
 * ... }, ...] }`. An empty `masks` array is a valid detection that found
 * nothing (the caller decides how to present that); any other shape —
 * missing/non-array `masks`, or entries without a usable URL — returns
 * `null` so the route fails with the classified detection-failure copy
 * instead of a crash. Mask entries lacking a URL are skipped rather than
 * failing the whole parse.
 * Side effects: none (pure).
 */
export function parseFurnishingDetectionResponse(
  data: unknown
): FurnishingDetectionResult | null {
  if (typeof data !== "object" || data === null) return null;
  const masks = (data as { masks?: unknown }).masks;
  if (!Array.isArray(masks)) return null;

  const maskUrls: string[] = [];
  for (const mask of masks) {
    if (typeof mask !== "object" || mask === null) continue;
    const url = (mask as { url?: unknown }).url;
    if (typeof url === "string" && url.trim() !== "") maskUrls.push(url);
  }
  return { maskUrls };
}
