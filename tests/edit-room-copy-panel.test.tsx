/**
 * Issue #1343 — `<CopyPanel>` (Listing copy tab).
 *
 * The CopyPanel replaces the #1342 stub. Two form fields (Headline
 * input + Description textarea with a 600-char counter) and one CTA
 * (Rewrite from directions), all driven by the parent's props. The
 * panel is mounted by the Inspector when activeTab === "copy".
 *
 * This test pins every contract that can be observed from rendered
 * markup (per the project's `renderToStaticMarkup` convention — see
 * `tests/edit-room-inspector.test.tsx` and `tests/sidebar-nav.test.tsx`).
 * The vitest config pins `environment: "node"`, so no DOM globals are
 * installed and click-flow tests are intentionally omitted here —
 * the parent-wiring test (`tests/edit-room-inspector.test.tsx`) and
 * the autosave-controller test pin the runtime behavior end-to-end.
 *
 * Acceptance criteria pinned here:
 *  - Headline `<input>` mirrors the `headline` prop and is paired
 *    with a `<label>` (htmlFor / id pairing).
 *  - Body `<textarea>` mirrors the `body` prop with `maxLength=600`,
 *    is paired with a `<label>`, and the 600-char counter reflects
 *    `body.length` at every boundary (0 / 1 / 599 / 600).
 *  - The "Rewrite from directions" button is a real `<button
 *    type="button">` with `data-testid="copy-rewrite-button"`.
 *  - The button is disabled when `directions.trim()` is empty.
 *  - The button carries `aria-busy="true"` + a "Writing…" marker
 *    while `isRewriting` is true.
 *  - The counter wrapper carries `aria-live="polite"` so screen
 *    readers announce the count.
 *  - Every color comes from an Atelier Canvas token (no hex
 *    literals in the rendered markup).
 *
 * Out of scope (covered elsewhere):
 *  - The Inspector's wiring of the panel (pinned by
 *    `tests/edit-room-inspector.test.tsx`).
 *  - The save-callback contract (pinned by `tests/autosave-copy.test.ts`).
 *  - The lookbook render fallback (pinned by `tests/listing-copy.test.ts`).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CopyPanel } from "@/components/edit-room/CopyPanel";

const baseProps = (overrides: Partial<Parameters<typeof CopyPanel>[0]> = {}) => ({
  headline: "" as string,
  body: "" as string,
  directions: "Warm lamps, lighter textiles" as string,
  isRewriting: false,
  bodyMaxLength: 600,
  onHeadlineChange: vi.fn(),
  onBodyChange: vi.fn(),
  onRewrite: vi.fn(),
  ...overrides,
});

describe("CopyPanel (issue #1343)", () => {
  it("renders a Headline input that mirrors the headline prop and is paired with a <label>", () => {
    const html = renderToStaticMarkup(
      <CopyPanel {...baseProps({ headline: "Initial headline" })} />
    );
    expect(html).toContain('id="copy-headline"');
    expect(html).toContain('value="Initial headline"');
    expect(html).toMatch(/<label[^>]*for="copy-headline"/);
  });

  it("renders a body <textarea> with maxLength=600, paired with a <label>, and mirrors body prop", () => {
    // React renders <textarea>'s value as children, not as a value
    // HTML attribute, so we match the children directly.
    const html = renderToStaticMarkup(
      <CopyPanel {...baseProps({ body: "Initial body copy" })} />
    );
    expect(html).toContain('id="copy-body"');
    expect(html).toContain('>Initial body copy<');
    expect(html).toMatch(/<textarea[^>]*maxLength="600"/);
    expect(html).toMatch(/<label[^>]*for="copy-body"/);
  });

  it("renders the 600-char counter reflecting the body's actual character count", () => {
    const html = renderToStaticMarkup(
      <CopyPanel {...baseProps({ body: "x".repeat(312) })} />
    );
    expect(html).toContain("312");
    expect(html).toContain("/ 600");
  });

  it("renders the counter at the 0 / 1 / 599 / 600 boundaries", () => {
    for (const len of [0, 1, 599, 600]) {
      const html = renderToStaticMarkup(
        <CopyPanel {...baseProps({ body: "x".repeat(len) })} />
      );
      expect(html).toContain(`${len} / 600`);
    }
  });

  it("renders the Rewrite button as <button type='button'> with data-testid='copy-rewrite-button'", () => {
    const html = renderToStaticMarkup(<CopyPanel {...baseProps()} />);
    expect(html).toContain("Rewrite from directions");
    expect(html).toContain('data-testid="copy-rewrite-button"');
    expect(html).toContain('type="button"');
  });

  it("disables the Rewrite button when directions.trim() is empty (whitespace-only)", () => {
    const html = renderToStaticMarkup(
      <CopyPanel {...baseProps({ directions: "   \n  " })} />
    );
    const buttonMatch = html.match(/<button[^>]*data-testid="copy-rewrite-button"[^>]*>/);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch![0]).toMatch(/\sdisabled(=|>)/);
  });

  it("disables the Rewrite button when directions='' (empty string)", () => {
    const html = renderToStaticMarkup(
      <CopyPanel {...baseProps({ directions: "" })} />
    );
    const buttonMatch = html.match(/<button[^>]*data-testid="copy-rewrite-button"[^>]*>/);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch![0]).toMatch(/\sdisabled(=|>)/);
  });

  it("shows aria-busy=true + 'Writing…' marker while isRewriting is true", () => {
    const html = renderToStaticMarkup(
      <CopyPanel {...baseProps({ isRewriting: true })} />
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Writing");
  });

  it("does not render any hex color literal (Atelier palette tokens only)", () => {
    const html = renderToStaticMarkup(<CopyPanel {...baseProps()} />);
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("the counter wrapper carries aria-live='polite' so screen readers announce the count", () => {
    const html = renderToStaticMarkup(<CopyPanel {...baseProps({ body: "abc" })} />);
    expect(html).toMatch(/aria-live="polite"[^>]*>[^<]*3 \/ 600/);
  });

  it("renders with all three props wired (no silent drops): headline + body + directions show in the markup", () => {
    const html = renderToStaticMarkup(
      <CopyPanel {...baseProps({ headline: "H", body: "B", directions: "D" })} />
    );
    expect(html).toContain('value="H"');
    expect(html).toContain('>B<'); // textarea children
    // The directions prop drives the disabled flag; "D" passes the
    // non-empty trim check so the button is NOT disabled.
    const buttonMatch = html.match(/<button[^>]*data-testid="copy-rewrite-button"[^>]*>/);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch![0]).not.toMatch(/\sdisabled(=|>)/);
  });
});
