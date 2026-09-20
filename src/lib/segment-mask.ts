/**
 * SAM click-to-segment helpers (issue #183).
 *
 * The mask editor's "Select Object" tool sends a clicked point to
 * `POST /api/segment`, which prompts fal.ai's Segment Anything endpoint
 * (`fal-ai/sam`) and returns a binary mask image (white = selected
 * object, black = background — the same white-on-black semantics as the
 * painted inpaint mask). This module keeps the endpoint choice, the
 * request payload shape, and the response parsing as pure logic so the
 * endpoint can be re-spiked (speed vs. accuracy) without touching route
 * or canvas code.
 */

/** fal.ai SAM endpoint used for point-prompted segmentation. */
export const FAL_SAM_MODEL = "fal-ai/sam";

/** Inputs for building a SAM point-prompt request. */
export interface SegmentPayloadInput {
  /** Source image URL fal will fetch and segment. */
  imageUrl: string;
  /** Clicked point in the source image's natural pixel space (origin top-left). */
  point: { x: number; y: number };
}

// Type alias (not interface) so the payload stays assignable to the
// `Record<string, unknown>` input type of `fal.subscribe` — same pattern
// as `FalFillPayload` in lib/prompts.ts.
export type FalSegmentPayload = {
  image_url: string;
  /** Foreground point prompt(s) in natural image pixels: [[x1, y1], ...]. */
  point_prompt: Array<[number, number]>;
  /** 1 = foreground label per point_prompt entry (0 would mark background). */
  point_label: number[];
  /** Combine multiple detected masks into a single black & white mask. */
  black_white: boolean;
  /** High-resolution masks so boundaries hug the object's real edges. */
  retina: boolean;
  /** Morphological cleanup for smoother boundaries (small latency cost). */
  better_quality: boolean;
};

/**
 * Builds the `input` payload for the fal.ai SAM point-prompted
 * segmentation call in `api/segment`.
 *
 * Contract: the point passes through unchanged (validation happens in the
 * route's zod schema); `black_white`/`retina`/`better_quality` are pinned
 * so the returned mask matches the mask editor's white-on-black,
 * edge-hugging expectations. The exact shape is pinned by
 * `tests/segment-mask.test.ts`.
 * Side effects: none (pure).
 */
export function buildFalSegmentPayload(input: SegmentPayloadInput): FalSegmentPayload {
  return {
    image_url: input.imageUrl,
    point_prompt: [[input.point.x, input.point.y]],
    point_label: [1],
    black_white: true,
    retina: true,
    better_quality: true,
  };
}

/**
 * Extracts the mask image URL from a fal.ai SAM response.
 *
 * Contract: the endpoint resolves to `{ image: { url, width, height, ... } }`
 * — the combined mask image. Returns `null` for any other shape so the
 * route can fail with the classified "segmentation failed" copy instead
 * of a crash. Does NOT validate the URL host: fal serves result media
 * from its own hosts, and the route re-encodes the bytes into a data URL
 * before they reach the browser.
 * Side effects: none (pure).
 */
export function parseFalSegmentResponse(data: unknown): { maskUrl: string } | null {
  if (typeof data !== "object" || data === null) return null;
  const image = (data as { image?: unknown }).image;
  if (typeof image !== "object" || image === null) return null;
  const url = (image as { url?: unknown }).url;
  if (typeof url !== "string" || url.trim() === "") return null;
  return { maskUrl: url };
}
