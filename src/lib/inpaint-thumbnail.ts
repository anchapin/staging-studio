/**
 * Browser-only helper that downsizes an image URL into a JPEG data URL
 * thumbnail.
 *
 * Extracted from the legacy `version-history-panel.tsx` (issue #1346
 * wave-5) so the keep-set hook `use-inpaint-runs.ts` does not have to
 * import the entire legacy panel just for this helper. The function
 * is pure (no React / no module-level state) and only ever runs in
 * the browser, so it lives in `src/lib/` as a plain module and the
 * call site in `use-inpaint-runs.ts` is responsible for the
 * `typeof window !== "undefined"` gate.
 *
 * The dimension math itself is pure and lives in
 * `thumbnail-geometry.ts` so it can be unit-pinned without going
 * through jsdom. This file owns the browser-only `Image` / `canvas`
 * glue; `thumbnail-geometry.ts` owns the math.
 *
 * @param imageUrl Publicly-fetchable image URL (Supabase Storage /
 *   any allowlisted host in `next.config.ts`).
 * @param maxDim Maximum width OR height of the downsized thumbnail
 *   in CSS pixels; the other axis is scaled proportionally. Default
 *   200.
 * @returns A JPEG data URL (no larger than `maxDim` on either axis)
 *   suitable for `<img src=…>` or `Room.beforeImageThumbnail`.
 */
import { computeThumbnailSize } from "@/lib/thumbnail-geometry";

export async function generateThumbnailFromUrl(
  imageUrl: string,
  maxDim: number = 200
): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("generateThumbnailFromUrl must run in the browser");
  }
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Image load failed for thumbnail"));
    img.src = imageUrl;
  });
  const { width, height } = computeThumbnailSize(
    img.naturalWidth,
    img.naturalHeight,
    maxDim,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not acquire 2D canvas context for thumbnail");
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.8);
}
