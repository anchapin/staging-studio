import { z } from "zod";

const IMAGE_HOST_PATTERN = /(^|\.)supabase\.co$|(^|\.)fal\.ai$/;
const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|mock)(:\d+)?$/i;

const imageUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      const url = new URL(value);
      if (url.protocol === "https:") {
        return IMAGE_HOST_PATTERN.test(url.hostname);
      }
      // Issue #264: allow http://127.0.0.1 and http://localhost for the e2e
      // harness mock storage. next.config images.remotePatterns already allows
      // loopback; the schema must also permit it so seeded fixture URLs pass
      // server-side validation before next/image render.
      if (url.protocol === "http:") {
        return LOCAL_HOST_PATTERN.test(url.hostname);
      }
      return false;
    },
    {
      message:
        "Image URL must be https with host *.supabase.co or *.fal.ai, or http://127.0.0.1/localhost (e2e mock storage)",
    }
  );

/**
 * Zod schema for partial room-image updates accepted by `PATCH
 * /api/projects/:projectId/rooms/:roomId`.
 *
 * Purpose: validates the JSON body of a room patch so only allowlisted
 * fields (`selectedVariantIndex`, the four before/after image URLs) are
 * ever written to `Room`. All fields are optional (clients patch only
 * what changed — e.g. `persistInpaintResult` saves a single after URL);
 * `.strict()` rejects unknown keys outright.
 *
 * Contract: every image URL must be HTTPS on `*.supabase.co` or
 * `*.fal.ai`, OR http://127.0.0.1/localhost for the e2e harness mock
 * storage. The http allowance is e2e-only (issue #264); production URLs
 * always use https remote hosts. `selectedVariantIndex` must be 0 or 1.
 * An entirely empty body (`{}`) parses, so the PATCH route must reject
 * it before handing `parsed.data` to Prisma (`updateMany` throws on empty
 * `data`).
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
  .partial()
  .strict();

/** The validated shape of a room patch request body ({@link roomPatchSchema}). */
export type RoomPatchInput = z.infer<typeof roomPatchSchema>;
