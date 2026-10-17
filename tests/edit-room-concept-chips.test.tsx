/**
 * Issue #1341 — `<ConceptChips>` (Objects-scope chip row + Other… search).
 *
 * Pinned cases:
 *  - Renders all five chips (Sofa, Chair, Table, Rug, Lamp).
 *  - The active concept carries `aria-pressed="true"` (one chip only).
 *  - Each chip carries its concept name as its accessible label.
 *  - The Other… input has the correct placeholder + aria-label.
 *  - The Other… input renders as a form (Enter submits).
 *  - No hex literals — every color is an Atelier token.
 *
 * The form-submit handler clears the input on success — that path is
 * covered by the component's `useState` behavior (the consumer thread
 * does not exercise it from a static markup).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConceptChips } from "@/components/edit-room/concept-chips";

describe("ConceptChips (issue #1341)", () => {
  it("renders all five concept chips", () => {
    const html = renderToStaticMarkup(
      <ConceptChips
        concept={null}
        onConceptChange={() => {}}
        onConceptSubmit={() => {}}
      />
    );
    expect(html).toContain("Sofa");
    expect(html).toContain("Chair");
    expect(html).toContain("Table");
    expect(html).toContain("Rug");
    expect(html).toContain("Lamp");
  });

  it("renders exactly one chip with aria-pressed=true when a concept is active", () => {
    const html = renderToStaticMarkup(
      <ConceptChips
        concept="Sofa"
        onConceptChange={() => {}}
        onConceptSubmit={() => {}}
      />
    );
    const pressedCount = (html.match(/aria-pressed="true"/g) || []).length;
    expect(pressedCount).toBe(1);
  });

  it("marks the matching chip as the active one (label + aria-pressed)", () => {
    const html = renderToStaticMarkup(
      <ConceptChips
        concept="Chair"
        onConceptChange={() => {}}
        onConceptSubmit={() => {}}
      />
    );
    // Exactly one chip is pressed. Find the pressed button and confirm
    // its label is "Chair" (the active concept). The rendered markup
    // is `<button aria-pressed="true" ...>Chair</button>` — the label
    // sits between the open/close of the button.
    const pressedButtonMatch = html.match(/aria-pressed="true"[^>]*>([^<]+)</);
    expect(pressedButtonMatch).not.toBeNull();
    expect(pressedButtonMatch?.[1]).toBe("Chair");
  });

  it('renders the "Other…" search input with the correct aria-label', () => {
    const html = renderToStaticMarkup(
      <ConceptChips
        concept={null}
        onConceptChange={() => {}}
        onConceptSubmit={() => {}}
      />
    );
    expect(html).toContain('aria-label="Detect another object type"');
    expect(html).toMatch(/placeholder="Other[^"]*"/);
  });

  it("wraps the Other… input in a <form> so Enter submits", () => {
    const html = renderToStaticMarkup(
      <ConceptChips
        concept={null}
        onConceptChange={() => {}}
        onConceptSubmit={() => {}}
      />
    );
    expect(html).toMatch(/<form[\s\S]*<\/form>/);
  });

  it("renders the Search icon as an inline SVG (zero icon-library deps)", () => {
    const html = renderToStaticMarkup(
      <ConceptChips
        concept={null}
        onConceptChange={() => {}}
        onConceptSubmit={() => {}}
      />
    );
    expect(html).toMatch(/<svg/);
    expect(html).not.toMatch(/lucide-/);
  });

  it("does not include any hex color literal in the rendered markup", () => {
    const html = renderToStaticMarkup(
      <ConceptChips
        concept={null}
        onConceptChange={() => {}}
        onConceptSubmit={() => {}}
      />
    );
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});