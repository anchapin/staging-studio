import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GeneratedVariationGrid from "@/components/canvas/generated-variation-grid";
import type { GeneratedVariation } from "@/components/canvas/generated-variation-grid";

// Issue #1115: the "Use This" button used to be rendered INSIDE the thumbnail
// <button> (invalid HTML, unusable by keyboard). Pin the new contract: it is
// a sibling overlay, hidden by default, and shown on wrapper hover or
// :focus-within so Tab + Enter can operate it.

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    <img alt={(props.alt as string) ?? ""} {...props} />
  ),
}));

const variation: GeneratedVariation = {
  id: "v1",
  thumbnailUrl: "https://example.test/thumb.png",
  resultUrl: "https://example.test/full.png",
  seed: 42,
  guidance: 7,
  strength: 0.8,
  generationTime: 12,
};

const baseProps = {
  roomName: "Living Room",
  variations: [variation],
  selectedId: null as string | null,
  isGenerating: false,
  generationProgress: "",
  onSelect: vi.fn(),
  onUse: vi.fn(),
};

describe("GeneratedVariationGrid Use This overlay (issue #1115)", () => {
  it("renders Use This as a sibling button, not nested inside the thumbnail", () => {
    const html = renderToStaticMarkup(createElement(GeneratedVariationGrid, baseProps));
    expect(html).toContain("Use This");
    // The overlay button opens AFTER the thumbnail button closes, never
    // inside it. (The grid also renders a disabled "Generate more
    // variations" button, so the total is three.)
    expect((html.match(/<button/g) ?? []).length).toBe(3);
    expect(html).toMatch(
      /<\/button><div[^>]*><button[^>]*aria-label="Use this Living Room variation"/,
    );
  });

  it("shows the overlay on wrapper hover or focus-within and keeps it pointer-inert by default", () => {
    const html = renderToStaticMarkup(createElement(GeneratedVariationGrid, baseProps));
    expect(html).toContain("group-focus-within/row:opacity-100");
    expect(html).toContain("group-hover/row:opacity-100");
    expect(html).toContain("pointer-events-none");
  });

  it("does not render Use This while the variation is selected", () => {
    const html = renderToStaticMarkup(
      createElement(GeneratedVariationGrid, { ...baseProps, selectedId: "v1" }),
    );
    expect(html).not.toContain("Use This");
  });

  it("does not render Use This while generating", () => {
    const html = renderToStaticMarkup(
      createElement(GeneratedVariationGrid, { ...baseProps, isGenerating: true }),
    );
    expect(html).not.toContain("Use This");
  });

  it("labels the thumbnail select button with pressed state and accessible name", () => {
    const html = renderToStaticMarkup(createElement(GeneratedVariationGrid, baseProps));
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Living Room variation, seed 42");
  });
});
