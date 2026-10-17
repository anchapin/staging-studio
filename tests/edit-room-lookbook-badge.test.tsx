/**
 * Issue #1340 — `<LookbookBadge>`.
 *
 * Pinned cases:
 *  - Renders the "Lookbook" label by default
 *  - Renders a custom label when one is supplied (future-proofing;
 *    the strip never overrides today)
 *  - Paints the bronze Atelier palette (`bg-secondary text-on-secondary`)
 *  - Carries the `data-testid="lookbook-badge"` so the VersionStrip test
 *    can find it without a CSS selector
 *  - Defense-in-depth: no raw hex literals
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LookbookBadge } from "@/components/edit-room/lookbook-badge";

describe("LookbookBadge (issue #1340)", () => {
  it('renders the default "Lookbook" label', () => {
    const html = renderToStaticMarkup(<LookbookBadge />);
    expect(html).toContain("Lookbook");
  });

  it("renders a custom label when one is supplied", () => {
    const html = renderToStaticMarkup(<LookbookBadge label="In Lookbook" />);
    expect(html).toContain("In Lookbook");
    expect(html).not.toMatch(/Lookbook<\/span>\s*<\/span>$/);
  });

  it('exposes data-testid="lookbook-badge" so the strip can target it', () => {
    const html = renderToStaticMarkup(<LookbookBadge />);
    expect(html).toContain('data-testid="lookbook-badge"');
  });

  it("uses the Atelier bronze/secondary palette", () => {
    const html = renderToStaticMarkup(<LookbookBadge />);
    // The badge paints `bg-secondary text-on-secondary` per
    // lookbook-badge.tsx (the issue's bronze choice). A raw hex here
    // would imply a missing token reference.
    expect(html).toContain("bg-secondary");
    expect(html).toContain("text-on-secondary");
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
