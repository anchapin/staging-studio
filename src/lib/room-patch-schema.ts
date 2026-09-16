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

export const roomPatchSchema = z
  .object({
    selectedVariantIndex: z.number().int().min(0).max(1),
    beforeImageUrl: imageUrlSchema,
    afterImageUrl: imageUrlSchema,
    beforeImageUrl2: imageUrlSchema,
    afterImageUrl2: imageUrlSchema,
  })
  .strict();

export type RoomPatchInput = z.infer<typeof roomPatchSchema>;
