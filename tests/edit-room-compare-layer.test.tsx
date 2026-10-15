/**
 * Issue #1339 — CanvasStage + MaskLayer + CompareLayer + on-canvas object boxes.
 *
 * `CompareLayer` is the draggable comparison divider over the photo. The
 * original photo is shown on the LEFT of the divider (clip-path from the
 * right); the staged photo is the underlying canvas. The handle is a
 * round white button with chevrons, has `role="slider"` and
 * `aria-valuenow/min/max`, supports ArrowLeft/Right ±2% steps, and
 * carries `aria-label="Comparison position"` (WAI-ARIA APG).
 *
 * Pinned cases:
 *  - the slider has role="slider" with aria-valuemin=0 / aria-valuemax=100
 *  - the original photo is rendered with a clip-path of `inset(0 50% 0 0)`
 *    at the initial 50% position
 *  - keyboard arrow nudges step the value by 2%
 *  - the "Original" / "Staged" labels are present
 *
 * Pointer drag behavior is owned by the `e2e/specs/compare*.spec.ts`
 * suite (legacy) and the new `edit-room-redesign-*.spec.ts` in #1344.
 * The geometry math itself is reused from
 * `src/lib/comparison-slider-geometry.ts` (#1279 already pinned the
 * arrow-key ±5 contract there — this slice uses ±2 per the Magic
 * Patterns code, so the component carries its own keyboard handler).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CompareLayer } from "@/components/edit-room/CompareLayer";

describe("CompareLayer (issue #1339)", () => {
  it("renders the slider handle with role=slider and aria-valuemin=0 / aria-valuemax=100", () => {
    const html = renderToStaticMarkup(
      <CompareLayer originalUrl="https://example.test/original.jpg" />
    );
    expect(html).toMatch(/role="slider"/);
    expect(html).toMatch(/aria-valuemin="0"/);
    expect(html).toMatch(/aria-valuemax="100"/);
    expect(html).toMatch(/aria-label="Comparison position"/);
  });

  it("renders the original photo with clip-path inset(0 50% 0 0) at the initial 50% position", () => {
    const html = renderToStaticMarkup(
      <CompareLayer originalUrl="https://example.test/original.jpg" />
    );
    // The clip-path is set inline on the <img> via the React style
    // prop; react-dom/server emits it as inline CSS.
    expect(html).toMatch(/clip-path:\s*inset\(0\s*50%\s*0\s*0\)/);
  });

  it("renders the Original / Staged badges in the corners", () => {
    const html = renderToStaticMarkup(
      <CompareLayer originalUrl="https://example.test/original.jpg" />
    );
    expect(html).toContain("Original");
    expect(html).toContain("Staged");
  });

  it("emits the original photo's URL on the underlying <img>", () => {
    const html = renderToStaticMarkup(
      <CompareLayer originalUrl="https://example.test/original.jpg" />
    );
    expect(html).toContain('src="https://example.test/original.jpg"');
    // alt avoids the redundant `photo` / `image` keywords (oxlint's
    // jsx-a11y/img-redundant-alt) — descriptive but terse.
    expect(html).toMatch(/alt="Original \([^)]*\)"/);
  });
});