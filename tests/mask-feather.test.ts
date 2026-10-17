/**
 * Browser-side mask feathering (issue #1362b, Stage B).
 *
 * Two pins cover the parts of `featherMask` that are testable under
 * vitest's `node` environment (vitest.config.ts sets the project
 * default to `node`, and adding a jsdom dependency for one test
 * file is overkill):
 *
 *  1. `radiusPx <= 0` returns the input unchanged (passthrough — the
 *     "Blend edges = 0" UX). This is the deterministic, no-DOM path.
 *  2. Calling `featherMask` with `radiusPx > 0` outside a DOM
 *     context throws the documented error (not a cryptic one). This
 *     pins the runtime guard so a future caller from a server-side
 *     context fails loudly with a useful message instead of crashing
 *     inside the canvas layer.
 *
 * The actual canvas round-trip — paint bitmap, apply CSS blur,
 * re-encode PNG, return new data URL — is browser-only and is not
 * covered by a vitest unit test (vitest's `node` env has no DOM,
 * and adding jsdom/happy-dom for one file is the wrong cost). It
 * runs in the Playwright e2e harness against a real browser.
 *
 * The schema-cap boundary at 40 px (the FineTune slider's max) is
 * pinned by `tests/metadata-schemas.test.ts` on the
 * `roomMetadataSchema.fineTuneExpand` constraint, NOT by this file.
 */
import { describe, expect, it } from "vitest";
import { featherMask } from "@/lib/mask-feather";

// A 2x2 opaque PNG, base64-encoded. The exact bytes are not load-
// bearing — the test asserts about behavior, not pixel identity.
const TINY_PNG_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNgYGD4z0AswK4SAAAA//8DAOIDQptTl8r8AAAAAElFTkSuQmCC";

describe("featherMask (issue #1362b)", () => {
  it("returns the input unchanged when radiusPx <= 0 (Blend edges = 0 UX)", async () => {
    const result = await featherMask(TINY_PNG_BASE64, 0);
    expect(result).toBe(TINY_PNG_BASE64);

    // Negative radius is also a no-op — the slider never produces one
    // (the input is `0..40`), but pinning the symmetry keeps the
    // contract honest.
    const resultNeg = await featherMask(TINY_PNG_BASE64, -5);
    expect(resultNeg).toBe(TINY_PNG_BASE64);
  });

  it("throws a documented error when called outside a DOM context", async () => {
    // vitest's `node` environment has no `window`/`document`. The
    // utility's runtime guard must surface a clear, actionable
    // message — not a cryptic ReferenceError on `document.createElement`.
    await expect(featherMask(TINY_PNG_BASE64, 12)).rejects.toThrow(
      /requires a DOM/i
    );
  });
});