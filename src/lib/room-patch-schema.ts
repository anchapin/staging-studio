import { z } from "zod";

const IMAGE_HOST_PATTERN = /(^|\.)supabase\.co$|(^|\.)fal\.ai$/;

const imageUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      const url = new URL(value);
      return url.protocol === "https:" && IMAGE_HOST_PATTERN.test(url.hostname);
    },
    {
      message:
        "Image URL must be https with host *.supabase.co or *.fal.ai (per next.config.ts images.remotePatterns)",
    }
  );

/**
 * Zod schema for partial room-image updates accepted by `PATCH
 * /api/projects/:projectId/rooms/:roomId`.
 *
 * Purpose: validates the JSON body of a room patch so only allowlisted
 * fields (`selectedVariantIndex`, the four before/after image URLs) are
 * ever written to `Room`. `.strict()` rejects unknown keys outright.
 *
 * Contract: every image URL must be HTTPS on `*.supabase.co` or
 * `*.fal.ai`, mirroring `next.config.ts` `images.remotePatterns` — a URL
 * from any other host fails validation (otherwise `next/image` would
 * throw at render time). `selectedVariantIndex` must be 0 or 1.
 *
 * Side effects: none — pure validation; no env vars needed.
 */
export const roomPatchSchema = z
  .object({
    selectedVariantIndex: z.number().int().min(0).max(1),
    beforeImageUrl: imageUrlSchema,
    afterImageUrl: imageUrlSchema,
    beforeImageUrl2: imageUrlSchema,
    afterImageUrl2: imageUrlSchema,
  })
  .strict();

/** The validated shape of a room patch request body ({@link roomPatchSchema}). */
export type RoomPatchInput = z.infer<typeof roomPatchSchema>;
