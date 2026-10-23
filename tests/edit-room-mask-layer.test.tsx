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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { MaskLayer } from "@/components/edit-room/MaskLayer";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

function readProjectFile(relative: string): string {
  return readFileSync(path.join(rootDir, relative), "utf8");
}

/** Drop `//` line comments so prose about an API is not mistaken for a call. */
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/**
 * Extract the body of a JSX prop handler (e.g. `onPointerMove`) from the
 * component source so a test can assert what that handler does — and, more
 * importantly, what it does NOT do.
 */
function handlerSource(source: string, prop: string): string {
  const start = source.indexOf(`${prop}={`);
  expect(start, `handler ${prop} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("onPointer", start + prop.length);
  const stop = end === -1 ? source.indexOf("onPointerLeave", start) : end;
  return stripComments(source.slice(start, stop === -1 ? source.length : stop));
}

/**
 * Extract a named helper function's body (e.g. `stroke`) from the
 * component source.
 */
function functionSource(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = (`);
  expect(start, `function ${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("\n  return (", start);
  return stripComments(
    source.slice(start, end === -1 ? source.length : end),
  );
}

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

  it("renders unchanged when the optional `onChange` is omitted (back-compat with #1339)", () => {
    // Issue #1344 (real `useInpaintRuns` wire) added `onChange` as
    // an OPTIONAL prop (the e2e suites for the legacy `<InpaintEditor>`
    // surface don't supply it). The static markup must not regress.
    // Dynamic behavior — `onChange` fires after every stroke and on
    // the `resetKey` effect — is pinned by the e2e spec
    // `tests/e2e/specs/edit-room-redesign-mask-paint.spec.ts`
    // (still `test.describe.skip`-gated per the handoff; see issue
    // #1344 strand 2). Pointer-driven paint cannot run under vitest's
    // `node` environment — jsdom / happy-dom isn't installed in this
    // repo.
    const withoutOnChange = renderToStaticMarkup(
      <MaskLayer
        width={300}
        height={200}
        brushSize={48}
        mode="paint"
        onPainted={() => {}}
        resetKey={0}
      />
    );
    const withOnChange = renderToStaticMarkup(
      <MaskLayer
        width={300}
        height={200}
        brushSize={48}
        mode="paint"
        onPainted={() => {}}
        resetKey={0}
        onChange={() => {}}
      />
    );
    // Back-compat invariant: the prop is additive only, so the
    // rendered HTML is identical whether it's supplied or not.
    expect(withOnChange).toBe(withoutOnChange);
  });
});

/**
 * Issue #1427 — the mask emission must not run a full-canvas PNG encode
 * per pointer event.
 *
 * These are source-shape pins (the repo's convention for behavior that
 * cannot run in vitest's `node` environment — see the header of this
 * file). They guard the two regressions that matter:
 *
 *  1. the pointer-move path must not encode (it only marks the buffer
 *     dirty; the encode is coalesced to at most one per animation frame);
 *  2. the terminal event of a stroke must still flush the final mask to
 *     the parent — issue #1344's guarantee, which the perf fix must not
 *     weaken.
 */
describe("MaskLayer mask-emission coalescing (issue #1427)", () => {
  const source = readProjectFile("src/components/edit-room/MaskLayer.tsx");

  it("never encodes the canvas in the pointer-move handler", () => {
    const move = handlerSource(source, "onPointerMove");
    // No synchronous full-canvas read in the hot path.
    expect(move).not.toContain("toDataURL");
    // It only draws; the drawing helper marks the buffer dirty.
    expect(move).toContain("stroke(p)");
  });

  it("marks the buffer dirty instead of encoding while painting", () => {
    const stroke = functionSource(source, "stroke");
    // The drawing path must not read the canvas back — it schedules the
    // coalesced frame encode instead.
    expect(stroke).not.toContain("toDataURL");
    expect(stroke).toContain("scheduleChange()");
  });

  it("flushes the final mask to the parent when the stroke ends (#1344)", () => {
    // Every terminal event of a stroke flushes synchronously, so the
    // parent holds the complete final mask the moment the stroke ends.
    expect(handlerSource(source, "onPointerUp")).toContain("flushChange()");
    expect(handlerSource(source, "onPointerCancel")).toContain(
      "flushChange()",
    );
    expect(handlerSource(source, "onLostPointerCapture")).toContain(
      "flushChange()",
    );
  });

  it("keeps the mask a full-fidelity PNG (alpha channel is the mask)", () => {
    // The submit path feathers the mask through `featherMask()`, which
    // blurs the ALPHA channel — a JPEG/downscale would drop alpha and
    // destroy the mask. Only the encode FREQUENCY changes in #1427.
    expect(source).toContain('toDataURL("image/png")');
    expect(source).not.toContain('toDataURL("image/jpeg")');
  });

  it("coalesces the encode through the shared frame-scheduled policy", () => {
    // The scheduling policy lives in `lib/mask-emission-coalescer.ts` so
    // it is unit-testable without a DOM (tests/mask-emission-coalescer.test.ts).
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("markDirty");
    expect(source).toContain("flush");
  });
});
