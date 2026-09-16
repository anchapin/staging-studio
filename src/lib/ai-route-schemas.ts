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
 * the FLUX.1 Fill generation.
 * Side effects: none (pure validation); the fal.ai call happens in the
 * route, gated by `assertFalConfigured()`/`FAL_KEY`.
 */
export const inpaintRequestSchema = z.object({
  imageUrl: aiImageUrlSchema,
  maskUrl: aiMaskUrlSchema,
  promptDirectives: z.string().min(1).max(2000),
  aesthetic: z.string().min(1).max(200),
});

/**
 * Zod schema for the `POST /api/generate-copy` request body.
 *
 * Contract: `roomId` identifies the room to persist copy to; optional
 * `roomName` (≤200 chars), `aesthetic` (≤200 chars), `rawDirectives`,
 * and `targetBuyer` provide GPT-4o-mini prompt context.
 * Side effects: none (pure validation); the OpenAI call happens in the
 * route, gated by `assertOpenAIConfigured()`/`OPENAI_API_KEY`.
 */
export const generateCopyRequestSchema = z.object({
  roomId: z.string(),
  roomName: z.string().max(200),
  rawDirectives: z.string(),
  aesthetic: z.string().max(200),
  targetBuyer: z.string(),
});
