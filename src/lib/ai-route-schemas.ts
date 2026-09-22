import { z } from "zod";

const IMAGE_HOST_PATTERN = /(^|\.)supabase\.co$|(^|\.)fal\.ai$/;

function isAllowlistedHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && IMAGE_HOST_PATTERN.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Zod schema for an AI-output image URL (source image for inpainting).
 *
 * Contract: HTTPS only, host on `*.supabase.co` or `*.fal.ai` — mirrors
 * `next.config.ts` `images.remotePatterns`, since these URLs end up in
 * `<Image src>` and any other host would throw at render time.
 * Side effects: none (pure validation).
 */
export const aiImageUrlSchema = z
  .string()
  .url()
  .refine(isAllowlistedHttpsUrl, {
    message:
      "Image URL must be https with host *.supabase.co or *.fal.ai (per next.config.ts images.remotePatterns)",
  });

// The canvas editor serializes the drawn mask to a data:image URL and sends it
// as maskUrl; data URLs never make fal fetch a remote resource, so they are
// allowed alongside the allowlisted hosts.
/**
 * Zod schema for the mask URL sent to the inpainting route.
 *
 * Contract: accepts either a `data:image/*` URL (how the canvas editor
 * serializes a drawn mask — data URLs never make fal fetch a remote
 * resource) or an allowlisted HTTPS URL ({@link aiImageUrlSchema} rules).
 * Capped at 5,000,000 characters to bound request bodies.
 * Side effects: none (pure validation).
 */
export const aiMaskUrlSchema = z
  .string()
  .max(5_000_000)
  .refine(
    (value) => value.startsWith("data:image/") || isAllowlistedHttpsUrl(value),
    {
      message:
        "Mask URL must be a data:image URL or https with host *.supabase.co or *.fal.ai",
    }
  );

/**
 * Zod schema for the `POST /api/inpaint` request body.
 *
 * Contract: `imageUrl` ({@link aiImageUrlSchema}) is the room photo to
 * edit; `maskUrl` ({@link aiMaskUrlSchema}) marks the region to fill;
 * `promptDirectives` (1–2000 chars) and `aesthetic` (1–200 chars) steer
 * the FLUX.1 Fill generation. `negativePrompt` is optional (issue #190):
 * the holistic full-room path sends `HOLISTIC_NEGATIVE_PROMPT` there;
 * omitted ⇒ the route keeps the single-object `NEGATIVE_PROMPT`.
 *
 * AI Guidance (issue #558):
 * - `promptStrength`: how closely AI follows the text prompt (0.1–1.0, default 0.8)
 * - `maskBlur`: feather edges of the mask for softer transitions (0–20, default 5)
 * - `seed`: reproducible results for iteration (0–999999, optional = random)
 * - `creativeMode`: higher variation (boolean, default false)
 * - `lockSeed`: reproduce exact results (boolean, default false)
 *
 * Side effects: none (pure validation); the fal.ai call happens in the
 * route, gated by `assertFalConfigured()`/`FAL_KEY`.
 */
export const inpaintRequestSchema = z.object({
  imageUrl: aiImageUrlSchema,
  maskUrl: aiMaskUrlSchema,
  promptDirectives: z.string().min(1).max(2000),
  aesthetic: z.string().min(1).max(200),
  negativePrompt: z.string().min(1).max(2000).optional(),
  // Issue #558: AI Guidance controls
  promptStrength: z.number().min(0.1).max(1.0).optional(),
  maskBlur: z.number().int().min(0).max(20).optional(),
  seed: z.number().int().min(0).max(999999).optional(),
  creativeMode: z.boolean().optional(),
  lockSeed: z.boolean().optional(),
});

/**
 * Zod schema for the `POST /api/generate-copy` request body.
 *
 * Contract: `roomId` alone identifies the room. Every prompt input
 * (`Room.name`, `Room.rawDirectives`, and the parent project's
 * `stagingAesthetic` / `targetBuyer`) is read server-side from the
 * persisted record, so the request body carries no prompt context and
 * project context is not spoofable per request. `.strict()` rejects
 * unknown keys (e.g. the legacy `roomName`/`aesthetic`/`targetBuyer`
 * fields) outright so stale clients fail loudly instead of silently
 * generating copy for a room other than the one they edited.
 * Side effects: none (pure validation); the OpenAI call happens in the
 * route, gated by `assertOpenAIConfigured()`/`OPENAI_API_KEY`.
 */
export const generateCopyRequestSchema = z
  .object({
    roomId: z.string().min(1),
  })
  .strict();

/**
 * Zod schema for a click-to-segment point in the source image's natural
 * pixel space (origin top-left). Coordinates must be finite and
 * non-negative; upper bounds are enforced against the image dimensions by
 * {@link segmentRequestSchema}'s cross-field refinement.
 * Side effects: none (pure validation).
 */
export const segmentPointSchema = z.object({
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
});

/**
 * Zod schema for the `POST /api/segment` request body (issue #183).
 *
 * Contract: `roomId` scopes the click to a room the caller owns (the
 * route re-checks ownership server-side); `imageUrl`
 * ({@link aiImageUrlSchema}) is the room photo fal will segment;
 * `point` ({@link segmentPointSchema}) is the clicked point in the
 * image's natural pixel space; `imageWidth`/`imageHeight` are the
 * natural dimensions the client measured for the same image, and the
 * point must fall within them. `.strict()` rejects unknown keys so
 * stale clients fail loudly.
 *
 * `warm` (issue #202) marks an editor-open pre-warm ping: the route runs
 * only the auth + room-ownership path and returns `{ warmed: true }`
 * WITHOUT calling fal (zero provider cost). The body still validates as
 * a full click — the probe point exercises the identical schema path a
 * real click takes — but the point is never executed.
 * Side effects: none (pure validation); the fal.ai SAM call happens in
 * the route, gated by `assertFalConfigured()`/`FAL_KEY`.
 */
export const segmentRequestSchema = z
  .object({
    roomId: z.string().min(1),
    imageUrl: aiImageUrlSchema,
    point: segmentPointSchema,
    imageWidth: z.number().int().positive().max(20_000),
    imageHeight: z.number().int().positive().max(20_000),
    warm: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => data.point.x <= data.imageWidth && data.point.y <= data.imageHeight,
    { message: "Point must fall within the image bounds" }
  );

/**
 * Zod schema for a SAM 3.1 detection concept (issue #227).
 *
 * Contract: a single lowercase word or short phrase — lowercase letters,
 * spaces, and hyphens only, 1–30 characters after trimming. Commas and
 * sentence punctuation are rejected BY VALIDATION (not just discouraged):
 * the issue-#223 spike probe showed SAM 3.1 returns ZERO masks for
 * multi-term comma lists and one weak mask for full sentences, so a
 * malformed concept can only waste a quota-billed call. The client-side
 * chip taxonomy mirrors these rules; members pass by construction.
 * Side effects: none (pure validation).
 */
export const segmentConceptSchema = z
  .string()
  .trim()
  .min(1, { message: "Concept must be 1–30 characters." })
  .max(30, { message: "Concept must be 1–30 characters." })
  .regex(/^[a-z -]+$/, {
    message:
      "Concept must be a single lowercase word or short phrase (letters, spaces, and hyphens only — no commas, numbers, or sentences).",
  });

/**
 * Zod schema for the `POST /api/segment/furnishings` request body
 * (issue #223, generalized in issue #227): text-prompted furnishings
 * detection. `roomId` scopes the detection to a room the caller owns
 * (the route re-checks ownership server-side); `imageUrl`
 * ({@link aiImageUrlSchema}) is the room photo fal will segment;
 * `concept` ({@link segmentConceptSchema}) is the optional detection
 * concept — omitted ⇒ the route's "furniture" default, keeping the
 * one-click preset path byte-equivalent. There is no point, image-size
 * pair, or warm flag — detection is prompted by a concept, not a click.
 * `.strict()` rejects unknown keys so stale clients fail loudly.
 * Side effects: none (pure validation).
 */
export const furnishingsSegmentRequestSchema = z
  .object({
    roomId: z.string().min(1),
    imageUrl: aiImageUrlSchema,
    concept: segmentConceptSchema.optional(),
  })
  .strict();

/** Upper bound on instances per vision-labeling request (mirrors detection). */
export const VISION_LABEL_MAX_CROPS = 30;

/**
 * Zod schema for one client-side instance crop: its detection-response
 * index and a `data:image/*` crop of that instance (the client rasterizes
 * the crop from the displayed source image — the server never fetches a
 * remote resource for vision input).
 * Side effects: none (pure validation).
 */
export const visionLabelCropSchema = z
  .object({
    instanceIndex: z.number().int().min(0).max(VISION_LABEL_MAX_CROPS - 1),
    cropDataUrl: z
      .string()
      .startsWith("data:image/")
      .min(100, { message: "Crop data is missing." })
      .max(1_500_000, { message: "Crop exceeds the size limit." }),
  })
  .strict();

/**
 * Zod schema for the `POST /api/label-instances` request body (issue
 * #252): ONE batched GPT-4o-mini vision request naming every instance of
 * a successful billed detection. `roomId` scopes the request to a room
 * the caller owns (the route re-checks ownership server-side);
 * `concept` ({@link segmentConceptSchema}) is the detection prompt the
 * vision model uses as a hint; `crops` carries one crop per instance.
 * Cache hits never reach this route (labeling is OpenAI-billed), so
 * there is no cache/warm flag. `.strict()` rejects unknown keys.
 * Side effects: none (pure validation); the OpenAI call happens in the
 * route, gated by `assertOpenAIConfigured()`/`OPENAI_API_KEY`.
 */
export const visionLabelRequestSchema = z
  .object({
    roomId: z.string().min(1),
    imageUrl: aiImageUrlSchema,
    concept: segmentConceptSchema,
    crops: z
      .array(visionLabelCropSchema)
      .min(1)
      .max(VISION_LABEL_MAX_CROPS),
  })
  .strict();

/**
 * Zod schema for the structured vision output the route asks the model
 * for: one short noun-phrase label per instance index. The route coerces
 * this into `{ labels: [{ instanceIndex, label }] }` for the client.
 * Side effects: none (pure validation).
 */
export const visionLabelOutputSchema = z.object({
  labels: z
    .array(
      z.object({
        instanceIndex: z.number().int().min(0),
        label: z.string().trim().min(1).max(60),
      })
    )
    .max(VISION_LABEL_MAX_CROPS),
});

/**
 * Zod schema for the inpaint pre-flight quality gate output (issue #600).
 *
 * One batched GPT-4o-mini evaluation run BEFORE `fal.queue.submit` to catch
 * costly directive mistakes before they enter the fal.ai queue:
 * - `specificity`: score 0–3 on how concrete vs generic the directives are
 * - `architecture_risk`: noul — populated ONLY when directives ask to change
 *   walls/flooring/windows/trim/doors/ceiling that the furnishings mask does
 *   not cover (i.e. the masked region won't hide the architectural change)
 * - `mentions_furnishings`: noul — populated ONLY when the directives describe
 *   the thing the mask actually covers (positive signal that the mask aligns
 *   with the stated intent)
 * - `qualityWarnings`: distinct warning strings; advisory only, never blocks
 *   submit; client deduplicates per-room on render
 *
 * Side effects: none (pure evaluation); the fal.ai inpaint call is gated
 * separately by `assertFalConfigured()`/`FAL_KEY`.
 */
export const inpaintQualityGateSchema = z.object({
  specificity: z.number().int().min(0).max(3),
  architecture_risk: z.string().optional(),
  mentions_furnishings: z.string().optional(),
  qualityWarnings: z.array(z.string()),
});

/**
 * Zod schema for the copy quality gate output (issue #600).
 *
 * One batched GPT-4o-mini evaluation run BETWEEN `generateObject` and
 * `saveRoomCopy` to surface copy quality issues before they are persisted:
 * - `specificity`: score 0–3 — concrete vs generic filler (cf.
 *   `GENERIC_FILLER` in `lookbook-pillars.ts`)
 * - `buyer_aligned`: noul — populated when copy doesn't speak to the target
 *   buyer persona
 * - `checklist_actionable`: noul — populated when checklist items are vague
 *   or non-actionable
 * - `aesthetic_consistent`: noul — populated when copy contradicts the
 *   staging aesthetic
 * - `qualityWarnings`: distinct warning strings; advisory only, never blocks
 *   save; client deduplicates per-room on render
 *
 * Side effects: none (pure evaluation); the OpenAI call is gated by
 * `assertOpenAIConfigured()`/`OPENAI_API_KEY`.
 */
export const copyQualityGateSchema = z.object({
  specificity: z.number().int().min(0).max(3),
  buyer_aligned: z.string().optional(),
  checklist_actionable: z.string().optional(),
  aesthetic_consistent: z.string().optional(),
  qualityWarnings: z.array(z.string()),
});
