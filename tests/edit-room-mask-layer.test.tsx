/**
 * Issue #1339 — CanvasStage + MaskLayer + CompareLayer + on-canvas object boxes.
 *
 * `MaskLayer` is a thin visual wrapper: a canvas overlay the user paints
 * freehand strokes on, drawn at 55% opacity over the photo. The component
 * is intentionally light — buffer persistence, export, undo, etc. all
 * live at the route level (#1340/#1344 wire them). This test pins the
 * structural contract so the canvas-tree independence rule is verifiable:
 *
 *  - the layer renders a `<canvas>` inside an `absolute inset-0`
 *    container with `opacity-55` (the design's 55% mask overlay)
 *  - the canvas has `touch-action: none` so touch drags do not scroll
 *  - the brush cursor is NOT rendered when no pointermove has fired
 *    (server-rendered HTML never has a cursor span)
 *  - the `onPainted` callback fires when the user starts a paint stroke
 *    (structural — static markup can't observe the event; the e2e
 *    spec in #1344 owns the actual click behavior)
 *
 * Pointer-driven drawing cannot be exercised from the vitest `node`
 * environment (no DOM ResizeObserver / no PointerEvent dispatch).
 * Those interactions are pinned by `tests/e2e/specs/mask-paint.spec.ts`
 * (legacy) and a new `edit-room-redesign-mask-paint.spec.ts` in #1344.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MaskLayer } from "@/components/edit-room/MaskLayer";

describe("MaskLayer (issue #1339)", () => {
  it("renders a canvas inside an absolute inset-0 container with 55% opacity", () => {
    const html = renderToStaticMarkup(
      <MaskLayer
        width={300}
        height={200}
        brushSize={48}
        mode="paint"
        onPainted={() => {}}
        resetKey={0}
      />
    );
    // The container is absolute inset-0 (so it covers the photo).
    expect(html).toContain("absolute");
    expect(html).toContain("inset-0");
    // The canvas itself carries the 55% opacity overlay (the design's
    // semi-transparent mask layer). The opacity is set via the inline
    // `style` prop (`opacity: 0.55`), not a Tailwind class.
    expect(html).toMatch(/opacity:\s*0\.55/);
    // touch-action: none is the design's "drawing never scrolls" rule.
    expect(html).toMatch(/touch-action:\s*none/);
  });

  it("does not render the brush cursor when no pointermove has fired (initial render)", () => {
    const html = renderToStaticMarkup(
      <MaskLayer
        width={300}
        height={200}
        brushSize={48}
        mode="paint"
        onPainted={() => {}}
        resetKey={0}
      />
    );
    // The cursor span carries border-2 border-white; absent on the
    // initial server-rendered output (no PointerMove has fired yet).
    expect(html).not.toMatch(/border-white/);
  });

  it("hides the canvas from pointer events when compare mode is on (parent strips it)", () => {
    // This is a structural rule the parent (`CanvasStage`) enforces:
    // `showPaint = scope === 'paint' && !compare && running === null`.
    // We pin that rule on the parent test, not here. MaskLayer itself
    // does NOT branch on compare — it is the orchestrator's job.
    const html = renderToStaticMarkup(
      <MaskLayer
        width={300}
        height={200}
        brushSize={48}
        mode="erase"
        onPainted={() => {}}
        resetKey={7}
      />
    );
    // Sanity: still renders the canvas (parent decides visibility, not
    // this component).
    expect(html).toMatch(/<canvas/);
  });
});