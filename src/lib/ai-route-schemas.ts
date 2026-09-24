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

export const aiImageUrlSchema = z
  .string()
  .url()
  .refine(isAllowlistedHttpsUrl, {
    message:
      "Image URL must be https with host *.supabase.co or *.fal.ai (per next.config.ts images.remotePatterns)",
  });

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

export const inpaintRequestSchema = z.object({
  imageUrl: aiImageUrlSchema,
  maskUrl: aiMaskUrlSchema,
  promptDirectives: z.string().min(1).max(2000),
  aesthetic: z.string().min(1).max(200),
  negativePrompt: z.string().min(1).max(2000).optional(),
  promptStrength: z.number().min(0.1).max(1.0).optional(),
  maskBlur: z.number().int().min(0).max(20).optional(),
  seed: z.number().int().min(0).max(999999).optional(),
  creativeMode: z.boolean().optional(),
  lockSeed: z.boolean().optional(),
});

export const generateCopyRequestSchema = z
  .object({
    roomId: z.string().min(1),
  })
  .strict();

export const segmentPointSchema = z.object({
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
});

export const segmentRequestSchema = z
  .object({
    roomId: z.string().min(1),
    imageUrl: aiImageUrlSchema,
    point: segmentPointSchema,
    imageWidth: z.number().positive().int(),
    imageHeight: z.number().positive().int(),
  })
  .strict();

export const batchRoomTypesRequestSchema = z
  .object({
    projectId: z.string().min(1),
    imageUrls: z.array(aiImageUrlSchema).min(1).max(20),
  })
  .strict();

export const inpaintQualityGateSchema = z.object({
  specificity: z.number().int().min(0).max(3),
  architecture_risk: z.string().optional(),
  mentions_furnishings: z.string().optional(),
  qualityWarnings: z.array(z.string()),
});

export const copyQualityGateSchema = z.object({
  specificity: z.number().int().min(0).max(3),
  buyer_aligned: z.string().optional(),
  checklist_actionable: z.string().optional(),
  aesthetic_consistent: z.string().optional(),
  qualityWarnings: z.array(z.string()),
});

const VISION_LABEL_MAX_CROPS = 50;

export const visionLabelRequestSchema = z
  .object({
    roomId: z.string().min(1),
    concept: z.string().min(1).max(200),
    crops: z
      .array(
        z.object({
          instanceIndex: z.number().int().min(0),
          cropDataUrl: aiMaskUrlSchema,
        })
      )
      .min(1)
      .max(VISION_LABEL_MAX_CROPS),
    imageUrl: aiImageUrlSchema,
  })
  .strict();

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
