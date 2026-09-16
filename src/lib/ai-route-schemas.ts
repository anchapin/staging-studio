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

// The canvas editor serializes the drawn mask to a data:image URL and sends it
// as maskUrl; data URLs never make fal fetch a remote resource, so they are
// allowed alongside the allowlisted hosts.
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
});

export const generateCopyRequestSchema = z.object({
  roomId: z.string(),
  roomName: z.string().max(200),
  rawDirectives: z.string(),
  aesthetic: z.string().max(200),
  targetBuyer: z.string(),
});
