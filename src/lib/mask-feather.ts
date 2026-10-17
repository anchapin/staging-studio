/**
 * Browser-side mask feathering for FineTune's "Blend edges" slider
 * (issue #1362b).
 *
 * Why a browser-side utility and not a server param: DashScope's
 * inpaint endpoint accepts a binary B/W mask — there is no
 * `mask_blur` / feathering parameter on the wire. The FineTune
 * `expand` slider used to forward as `maskBlur` (#558), which
 * silently dropped on the Alibaba adapter. This replaces that with a
 * pre-upload Gaussian-style feathering pass: paint the mask onto a
 * `<canvas>`, apply a `ctx.filter = "blur(Npx)"` pass, re-encode as
 * PNG, return the new data URL. The provider then sees a mask with
 * the soft edges the user requested.
 *
 * Pure / browser-only. `typeof window !== "undefined"` guard at the
 * top of the entry point so importing this module from a server file
 * (e.g. a server component, an API route) does not blow up at module
 * load — only the actual `featherMask()` call needs the DOM, and the
 * caller is responsible for calling it from a browser-only context
 * (the FineTune submit path, which already runs client-side).
 *
 * Pinned by `tests/mask-feather.test.ts` (3 pins: zero radius
 * passthrough, positive radius produces a feathered PNG, schema-cap
 * boundary at 40 px).
 */

/**
 * Result shape returned by `featherMask`. Carries the new PNG data
 * URL plus the resolved dimensions so the caller can re-stamp it into
 * the mask snapshot. Dimensions are pixel counts from the source
 * canvas; for a `<canvas>` whose bitmap came from a `data:image/png`
 * URL of unknown size, the browser fills these in based on the
 * decoded bitmap.
 */
export interface FeatheredMask {
  /** New mask data URL — `featherRadius === 0` ⇒ identical to input. */
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Decode the input `data:image/png;base64,…` URL, paint it onto an
 * offscreen canvas at native size, apply a CSS blur filter at the
 * given pixel radius, re-encode as PNG, and return the new data URL.
 *
 * Contract:
 *  - `radiusPx <= 0` returns the input unchanged (no canvas round-
 *    trip). This is the "Blend edges = 0" UX — the user has opted out
 *    of feathering, so the original painted mask reaches the provider
 *    byte-equivalent.
 *  - `radiusPx > 0` produces a feathered PNG. The blur is a single
 *    CSS `ctx.filter = "blur(Npx)"` pass — not a box-blur, not a true
 *    Gaussian, but visually indistinguishable for the mask-paint UX
 *    (this is the same feathering semantic `fal`'s `mask_blur`
 *    offered, just computed client-side).
 *  - The output dimensions match the input bitmap. The provider's
 *    mask and image dimensions are decoupled on Alibaba (instruction
 *    mode), but on fal / Replicate a size mismatch would fail; either
 *    way we preserve the source size.
 *  - Throws when called in a non-DOM context (no `window`); the
 *    server-side caller is responsible for not invoking it.
 *
 * Side effects: creates an in-memory `<canvas>` and runs the
 * browser's PNG encoder. No network. Returns a base64 PNG string.
 */
export async function featherMask(
  maskPngBase64: string,
  radiusPx: number
): Promise<string> {
  const result = await featherMaskWithMetadata(maskPngBase64, radiusPx);
  return result.dataUrl;
}

/**
 * Like {@link featherMask}, but also returns the canvas dimensions.
 * Tests prefer this — they assert against both `dataUrl` and the
 * dimension pair to catch a future regression where someone changes
 * the canvas size and silently clips the mask.
 */
export async function featherMaskWithMetadata(
  maskPngBase64: string,
  radiusPx: number
): Promise<FeatheredMask> {
  if (radiusPx <= 0) {
    // Passthrough — skip the canvas round-trip when the user has not
    // asked for feathering (the common case for a default-seeded
    // expand of 0). The DOM check below fires only when we actually
    // need the canvas; passthrough is callable from any context
    // (it's a no-op). Pin: tests/mask-feather.test.ts > "returns the
    // input unchanged when radiusPx <= 0".
    return {
      dataUrl: maskPngBase64,
      width: 0,
      height: 0,
    };
  }
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error(
      "featherMask requires a DOM (HTMLCanvasElement); call from a browser-only context"
    );
  }

  const bitmap = await loadMaskBitmap(maskPngBase64);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error(
      "featherMask: 2D canvas context unavailable; cannot feather mask"
    );
  }

  // Paint the bitmap onto the canvas, then apply a CSS blur filter
  // and re-draw the same bitmap. The CSS blur smooths the alpha
  // channel — painted-mask edges feather naturally.
  ctx.filter = `blur(${radiusPx}px)`;
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);

  const dataUrl = canvas.toDataURL("image/png");
  return {
    dataUrl,
    width: bitmap.width,
    height: bitmap.height,
  };
}

/**
 * Decode a `data:image/png;base64,…` URL into an `ImageBitmap`. The
 * browser's `createImageBitmap` is widely supported (Chrome, Safari,
 * Firefox, Node 18+ via `node:canvas`-shimmed envs) and avoids the
 * `<img>` round-trip.
 */
async function loadMaskBitmap(maskPngBase64: string): Promise<ImageBitmap> {
  // Use `fetch(data:...)` so the URL is parsed by the browser's URL
  // parser — the only reliable way to feed a data URL to
  // `createImageBitmap`.
  const response = await fetch(maskPngBase64);
  if (!response.ok) {
    throw new Error(
      `featherMask: failed to decode mask data URL (status ${response.status})`
    );
  }
  const blob = await response.blob();
  return await createImageBitmap(blob);
}