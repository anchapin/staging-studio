/**
 * Unit tests for `generateThumbnailFromUrl` (issue #1520).
 *
 * The helper lives in `src/lib/inpaint-thumbnail.ts` and is
 * browser-only glue (`Image` / `canvas`). Its pure dimension math
 * was extracted into `src/lib/thumbnail-geometry.ts` and is pinned
 * there (`tests/thumbnail-geometry.test.ts`).
 *
 * What this file pins is the FAILURE POLICY of the glue: outside a
 * browser there is no `window`, no `Image` and no canvas, so the
 * function must reject with an explicit "must run in the browser"
 * error instead of hanging on an image load that can never
 * complete. The vitest environment for this file is `node`, which
 * makes that branch directly assertable.
 */
import { describe, expect, it } from "vitest";
import { generateThumbnailFromUrl } from "@/lib/inpaint-thumbnail";

describe("generateThumbnailFromUrl", () => {
  it("rejects when there is no browser window to render in", async () => {
    // The vitest environment for this file is `node` — there is no
    // `window`/`document`, so the canvas glue can never run.
    expect(typeof window).toBe("undefined");
    await expect(
      generateThumbnailFromUrl("https://example.com/image.png"),
    ).rejects.toThrow(/must run in the browser/);
  });

  it("rejects for an empty url in a non-browser environment", async () => {
    await expect(generateThumbnailFromUrl("")).rejects.toThrow(
      /must run in the browser/,
    );
  });

  it("rejects for a non-empty url in a non-browser environment", async () => {
    await expect(
      generateThumbnailFromUrl("https://example.com/image.png", 120),
    ).rejects.toThrow(/must run in the browser/);
  });
});
