/**
 * Hard cap on the decoded size of a thumbnail data URL accepted by
 * `saveInpaintVersion` (src/app/actions/inpaint-versions.ts).
 *
 * The action server-fetches this string (`fetch(dataUrl)`) and uploads the
 * bytes to the public `room-photos` bucket, so an unbounded value would let
 * any authenticated caller turn the action into an arbitrary-size upload.
 * 2 MiB decoded comfortably exceeds any client-rendered JPEG thumbnail.
 */
export const MAX_THUMBNAIL_DATA_URL_BYTES = 2 * 1024 * 1024;

export type ThumbnailDataUrlCheck = { ok: true } | { ok: false; error: string };

/**
 * Validates a client-supplied thumbnail data URL BEFORE the action fetches
 * it (issue #683). Only `data:image/...;<base64>` URLs are allowed — any
 * other scheme (http/https/file/data:text) is rejected so the action can
 * never be used as a server-side request forgery vector. The base64 payload
 * must decode to at most {@link MAX_THUMBNAIL_DATA_URL_BYTES} bytes.
 * Side effects: none (pure validation).
 */
export function validateThumbnailDataUrl(
  value: string
): ThumbnailDataUrlCheck {
  if (!value.startsWith("data:image/")) {
    return {
      ok: false,
      error: "Thumbnail must be a data:image/… data URL.",
    };
  }

  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) {
    return { ok: false, error: "Thumbnail data URL is missing its payload." };
  }

  const base64 = value.slice(commaIndex + 1);
  const decodedBytes = Math.floor((base64.length * 3) / 4);
  if (decodedBytes > MAX_THUMBNAIL_DATA_URL_BYTES) {
    return {
      ok: false,
      error: `Thumbnail exceeds the ${MAX_THUMBNAIL_DATA_URL_BYTES}-byte size limit.`,
    };
  }

  return { ok: true };
}
