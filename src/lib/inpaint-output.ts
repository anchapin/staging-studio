/**
 * Normalizes an inpaint model's raw output into a list of image URLs
 * (#1199). The inference abstraction returns each provider's raw model
 * output with no envelope, and the shapes differ:
 *
 * - fal `fal-ai/flux-lora-fill` / `flux-fill`:
 *   `{ images: [{ url, width?, height?, content_type? }], seed?, ... }`
 *   (older fal models also used `{ image: { url } }`).
 * - Replicate `black-forest-labs/flux-fill-pro`: the prediction
 *   `output` is a URL string, or an array of URL strings (`[url1, url2]`)
 *   depending on model version and `num_outputs`.
 *
 * Anything else yields `[]`, which the poller treats as "no image yet"
 * (`retryable`), same as before. Pure; no side effects.
 */

/** Loose view of fal's FLUX Fill output; extra fields are allowed. */
export interface FalFillOutput {
  images?: Array<{ url?: unknown } | string | null | undefined>;
  image?: { url?: unknown } | string | null;
  [key: string]: unknown;
}

/** Anything a provider might hand back for an inpaint job. */
export type RawInpaintOutput = FalFillOutput | string | unknown[] | null | undefined;

function asHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function urlFromEntry(entry: unknown): string | null {
  if (typeof entry === "string") return asHttpUrl(entry);
  if (entry && typeof entry === "object" && "url" in entry) {
    return asHttpUrl((entry as { url?: unknown }).url);
  }
  return null;
}

export function extractInpaintImageUrls(output: unknown): string[] {
  if (output == null) return [];
  // Replicate: bare URL string.
  if (typeof output === "string") {
    const url = asHttpUrl(output);
    return url ? [url] : [];
  }
  // Replicate: array of URL strings (or, defensively, of {url} objects).
  if (Array.isArray(output)) {
    return output.map(urlFromEntry).filter((u): u is string => u !== null);
  }
  if (typeof output === "object") {
    const obj = output as FalFillOutput & { output?: unknown };
    // fal: { images: [{ url }] }
    if (Array.isArray(obj.images)) {
      const urls = obj.images.map(urlFromEntry).filter((u): u is string => u !== null);
      if (urls.length > 0) return urls;
    }
    // fal (older models): { image: { url } }
    const single = urlFromEntry(obj.image);
    if (single) return [single];
    // A prediction envelope that slipped through unwrapped: { output: ... }
    if ("output" in obj && obj.output !== output) {
      return extractInpaintImageUrls(obj.output);
    }
  }
  return [];
}

/** First image URL, or null when the output carries none. */
export function firstInpaintImageUrl(output: unknown): string | null {
  return extractInpaintImageUrls(output)[0] ?? null;
}
