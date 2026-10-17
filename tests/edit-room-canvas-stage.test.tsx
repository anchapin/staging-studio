/**
 * Issue #1339 — CanvasStage + MaskLayer + CompareLayer + on-canvas object boxes.
 *
 * `CanvasStage` is the top-level canvas orchestrator. It renders:
 *  - a scope-aware toolbar (caption + paint controls / Compare button)
 *  - the photo as the largest thing on the page (3:2 aspect)
 *  - the `<CompareLayer>` when compare mode is on
 *  - on-canvas object buttons when scope="objects" and not comparing
 *  - the `<MaskLayer>` when scope="paint" and not comparing and not running
 *  - the running-progress overlay when a run is in flight
 *
 * Pinned cases:
 *  - Paint controls render only when scope === "paint" && !compare && !running
 *  - Compare button renders only when viewing !== "original"
 *  - Object buttons render only when scope === "objects" && !compare && !running
 *  - Caption text reflects (viewing, compare): "Viewing the original photo"
 *    vs "Viewing Variant A — drag to compare with original"
 *  - On-canvas object buttons fire `onToggleObject` (structural — the
 *    e2e spec owns the click behavior)
 *  - Running overlay renders when running !== null
 *
 * `useFitSize`'s ResizeObserver is not exercised from the vitest
 * `node` environment; the static render does not measure the photo.
 * That is pinned by `tests/edit-room-use-fit-size.test.ts`.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CanvasStage } from "@/components/edit-room/CanvasStage";
import type { DetectedObject } from "@/components/edit-room/CanvasStage";

const DETECTIONS: DetectedObject[] = [
  { id: "sofa", concept: "Sofa", label: "Sofa", box: { x: 49, y: 57, w: 31, h: 42 } },
  { id: "lamp", concept: "Lamp", label: "Floor lamp", box: { x: 0, y: 42, w: 19, h: 44 } },
];

const baseProps = () => ({
  imageUrl: "https://example.test/staged.jpg",
  originalUrl: "https://example.test/original.jpg",
  viewing: "B" as const,
  scope: "paint" as const,
  compare: false,
  onToggleCompare: () => {},
  concept: "Sofa",
  selected: [] as string[],
  onToggleObject: () => {},
  detections: DETECTIONS,
  maskVersion: 0,
  onMaskPainted: () => {},
  onClearMask: () => {},
  hasMask: false,
  brushSize: 48,
  onBrushSizeChange: () => {},
  brushMode: "paint" as const,
  onBrushModeChange: () => {},
  running: null,
  targetSlot: "B" as const,
});

describe("CanvasStage (issue #1339)", () => {
  it("renders the photo URL when supplied", () => {
    const html = renderToStaticMarkup(<CanvasStage {...baseProps()} />);
    expect(html).toContain('src="https://example.test/staged.jpg"');
  });

  it("renders the caption 'Viewing Variant B' when viewing=B", () => {
    const html = renderToStaticMarkup(<CanvasStage {...baseProps()} />);
    expect(html).toContain("Viewing");
    expect(html).toContain("Variant B");
  });

  it("renders the caption 'Viewing the original photo' when viewing=original", () => {
    const html = renderToStaticMarkup(
      <CanvasStage {...baseProps()} viewing="original" />
    );
    expect(html).toContain("original photo");
    expect(html).not.toContain("Variant");
  });

  it("appends '— drag to compare with original' when compare is on", () => {
    const html = renderToStaticMarkup(
      <CanvasStage {...baseProps()} compare={true} />
    );
    expect(html).toContain("drag to compare with original");
  });

  it("renders the paint controls when scope=paint and !compare and !running", () => {
    const html = renderToStaticMarkup(
      <CanvasStage {...baseProps()} scope="paint" />
    );
    // The paint toolbar carries Brush/Eraser tool buttons + the Size slider.
    expect(html).toContain("Brush");
    expect(html).toContain("Eraser");
    expect(html).toContain("Size");
    expect(html).toContain('type="range"');
    expect(html).toContain("Clear");
  });

  it("hides the paint controls when compare is on", () => {
    const html = renderToStaticMarkup(
      <CanvasStage {...baseProps()} scope="paint" compare={true} />
    );
    // The MaskLayer's canvas is the main paint affordance; with
    // compare on the parent doesn't render paint controls.
    expect(html).not.toMatch(/type="range"/);
  });

  it("hides the paint controls when a run is in flight", () => {
    const html = renderToStaticMarkup(
      <CanvasStage {...baseProps()} scope="paint" running={42} />
    );
    expect(html).not.toMatch(/type="range"/);
  });

  it("renders the Compare button only when viewing is not 'original'", () => {
    const viewingHtml = renderToStaticMarkup(
      <CanvasStage {...baseProps()} viewing="B" />
    );
    expect(viewingHtml).toContain("Compare");

    const originalHtml = renderToStaticMarkup(
      <CanvasStage {...baseProps()} viewing="original" />
    );
    expect(originalHtml).not.toContain("Compare");
  });

  it("renders on-canvas object buttons when scope=objects and !compare and !running", () => {
    const html = renderToStaticMarkup(
      <CanvasStage {...baseProps()} scope="objects" concept="Sofa" />
    );
    // Only the Sofa concept is shown — the Sofa detection (label=Sofa)
    // renders, the Lamp detection (label=Floor lamp) is filtered out.
    const sofaButtons = (html.match(/aria-label="Sofa"/g) || []).length;
    expect(sofaButtons).toBe(1);
    expect(html).not.toContain('aria-label="Floor lamp"');
  });

  it("filters object buttons by concept (the design's per-concept overlay)", () => {
    const html = renderToStaticMarkup(
      <CanvasStage {...baseProps()} scope="objects" concept="Lamp" />
    );
    expect(html).toContain('aria-label="Floor lamp"');
    expect(html).not.toContain('aria-label="Sofa"');
  });

  it("hides object buttons when scope=objects and compare is on", () => {
    const html = renderToStaticMarkup(
      <CanvasStage
        {...baseProps()}
        scope="objects"
        compare={true}
        concept="Sofa"
      />
    );
    expect(html).not.toContain('aria-label="Sofa"');
  });

  it("hides object buttons when a run is in flight", () => {
    const html = renderToStaticMarkup(
      <CanvasStage
        {...baseProps()}
        scope="objects"
        running={42}
        concept="Sofa"
      />
    );
    expect(html).not.toContain('aria-label="Sofa"');
  });

  it("renders the running overlay when running is a number", () => {
    const html = renderToStaticMarkup(
      <CanvasStage {...baseProps()} running={50} />
    );
    // The overlay shows the progress percent in tabular-nums.
    expect(html).toContain("50%");
  });

  it("uses Atelier palette tokens (no raw hex literals)", () => {
    const html = renderToStaticMarkup(<CanvasStage {...baseProps()} />);
    // Defense-in-depth: the component must pull every color from the
    // Atelier token table (color-tokens.ts). A raw hex in the rendered
    // HTML would imply a missing token reference.
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});