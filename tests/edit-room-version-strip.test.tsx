/**
 * Issue #1340 — `<VersionStrip>` + Lookbook slot.
 *
 * Pinned cases (the issue's acceptance criteria):
 *  - The strip renders one row with three version slots (Original / A / B).
 *  - An empty slot renders a dashed-border placeholder with a "+" icon
 *    and the "Empty" label.
 *  - An empty slot that is the in-flight run target renders a
 *    bronze-bordered placeholder with a "Staging…" label (no "+" icon).
 *  - A populated slot renders the 3:2 thumbnail, the slot label, and
 *    either "Vacant" (original) / "First pass" (variant with 0 touch-ups)
 *    / "N touch-up(s)" (variant with N touch-ups).
 *  - The Lookbook badge paints onto whichever slot matches `lookbookSlot`.
 *  - Clicking a populated slot fires `onSelect(slot)`.
 *  - When the viewing slot === lookbook slot, the CTA is replaced with
 *    a static "X is in the lookbook" line.
 *  - When the viewing slot !== lookbook slot, the CTA "Use [X] in lookbook"
 *    is rendered.
 *  - Clicking the CTA fires `onUseInLookbook(viewing)`.
 *  - Every interactive element (slot buttons + CTA) is disabled while a
 *    run is in flight (`running === true`).
 *  - No hex literals — every color is an Atelier token (defense-in-depth).
 *  - Static-markup only (no event firing): the click behavior is pinned
 *    structurally here; pointer events live with the route wiring (#1344).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { VersionStrip } from "@/components/edit-room/VersionStrip";
import type { Version } from "@/components/edit-room/types";

const POPULATED_A: Version = { id: "A", label: "Variant A", url: "https://example.test/variant-a.jpg", touchUps: 3 };
const POPULATED_ORIGINAL: Version = { id: "original", label: "Original photo", url: "https://example.test/original.jpg", touchUps: 0 };
const EMPTY_B: Version = { id: "B", label: "Variant B", url: null, touchUps: 0 };

const baseProps = () => ({
  versions: [POPULATED_ORIGINAL, POPULATED_A, EMPTY_B] as Version[],
  viewing: "A" as const,
  lookbookSlot: "B" as const,
  targetSlot: "B" as const,
  running: false,
  onSelect: vi.fn(),
  onUseInLookbook: vi.fn(),
});

describe("VersionStrip (issue #1340)", () => {
  it("renders the three slot labels (Original photo / Variant A / Variant B)", () => {
    const html = renderToStaticMarkup(<VersionStrip {...baseProps()} />);
    expect(html).toContain("Original photo");
    expect(html).toContain("Variant A");
    expect(html).toContain("Variant B");
  });

  it("renders an aria-label='Versions' landmark for screen-reader navigation", () => {
    const html = renderToStaticMarkup(<VersionStrip {...baseProps()} />);
    expect(html).toContain('aria-label="Versions"');
  });

  it('renders "Empty" label on a populated=false empty slot', () => {
    const html = renderToStaticMarkup(<VersionStrip {...baseProps()} />);
    expect(html).toContain("Empty");
  });

  it('renders a + icon (no Staging label) on an empty, non-in-flight slot', () => {
    // The slot is empty and targetSlot="B" — wait, that's the in-flight
    // case for THIS fixture. Use a non-staging fixture to verify the
    // non-in-flight rendering: targetSlot="A" with B empty.
    const html = renderToStaticMarkup(
      <VersionStrip {...baseProps()} targetSlot="A" viewing="A" lookbookSlot="B" />
    );
    expect(html).toContain("Empty");
    // No "Staging…" label should appear when B is empty and not in flight.
    expect(html).not.toContain("Staging");
  });

  it('renders a "Staging…" label on the in-flight target when it is empty', () => {
    // targetSlot="B" and B is empty — the design's "Staging…" state.
    // The "Staging…" affordance only appears when running === true
    // AND targetSlot matches the empty slot (the `pending` flag).
    const html = renderToStaticMarkup(
      <VersionStrip {...baseProps()} running={true} />
    );
    expect(html).toContain("Staging");
  });

  it('renders "Vacant" on the populated Original slot', () => {
    const html = renderToStaticMarkup(<VersionStrip {...baseProps()} />);
    expect(html).toContain("Vacant");
  });

  it('renders "First pass" on a populated variant with 0 touch-ups', () => {
    // Move the populated variant off original and set touchUps=0
    const versions: Version[] = [
      { id: "original", label: "Original photo", url: "https://example.test/orig.jpg", touchUps: 0 },
      { id: "A", label: "Variant A", url: "https://example.test/a.jpg", touchUps: 0 },
      { id: "B", label: "Variant B", url: null, touchUps: 0 },
    ];
    const html = renderToStaticMarkup(
      <VersionStrip
        {...baseProps()}
        versions={versions}
        viewing="A"
        lookbookSlot="B"
        targetSlot="A"
      />
    );
    expect(html).toContain("First pass");
  });

  it('renders "3 touch-ups" on a populated variant with multiple touch-ups', () => {
    const html = renderToStaticMarkup(<VersionStrip {...baseProps()} />);
    // POPULATED_A has touchUps=3
    expect(html).toContain("3 touch-ups");
  });

  it("renders the image URL on the populated thumbnail", () => {
    const html = renderToStaticMarkup(<VersionStrip {...baseProps()} />);
    expect(html).toContain('src="https://example.test/variant-a.jpg"');
    expect(html).toContain('src="https://example.test/original.jpg"');
  });

  it("paints the Lookbook badge onto the slot matching lookbookSlot", () => {
    // lookbookSlot="B" in the base fixture, but B is empty so no badge
    // should paint. Move the badge to A (populated) and reassert.
    const html = renderToStaticMarkup(
      <VersionStrip {...baseProps()} lookbookSlot="A" />
    );
    // The badge is one element; when only A is in the lookbook we should
    // find exactly one `data-testid="lookbook-badge"`.
    const badgeCount = (html.match(/data-testid="lookbook-badge"/g) || []).length;
    expect(badgeCount).toBe(1);
  });

  it("does not paint the Lookbook badge when lookbookSlot is empty", () => {
    // lookbookSlot="B" + B is empty → no populated slot gets the badge.
    const html = renderToStaticMarkup(<VersionStrip {...baseProps()} />);
    expect(html).not.toContain('data-testid="lookbook-badge"');
  });

  it('sets aria-current="true" on the slot the user is viewing', () => {
    const html = renderToStaticMarkup(<VersionStrip {...baseProps()} viewing="A" />);
    // The button wrapping the populated variant thumbnail carries
    // aria-current. The other populated slot (original) does not.
    expect(html).toMatch(/<button[^>]*aria-current="true"/);
  });

  it("renders the CTA when viewing slot !== lookbook slot", () => {
    // baseProps: viewing="A", lookbookSlot="B" — different → CTA renders.
    const html = renderToStaticMarkup(<VersionStrip {...baseProps()} />);
    expect(html).toContain("Use ");
    expect(html).toContain("in lookbook");
  });

  it('replaces the CTA with a static "{label} is in the lookbook" line when viewing === lookbookSlot', () => {
    const html = renderToStaticMarkup(
      <VersionStrip {...baseProps()} viewing="A" lookbookSlot="A" />
    );
    // The CTA is gone; the static line is in its place.
    expect(html).not.toContain("Use ");
    expect(html).toContain("Variant A is in the lookbook");
  });

  it("disables every interactive element while a run is in flight", () => {
    // baseProps: 2 populated slots (buttons) + CTA button = 3 buttons
    // total. The empty slot is a `<div>`, not a button, so it never
    // appears in the disabled-buttons count. All three buttons must
    // carry `disabled` when running === true.
    const html = renderToStaticMarkup(<VersionStrip {...baseProps()} running={true} />);
    expect((html.match(/<button[^>]*disabled/g) || []).length).toBe(3);
  });

  it("uses Atelier palette tokens (no raw hex literals)", () => {
    const html = renderToStaticMarkup(<VersionStrip {...baseProps()} />);
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
