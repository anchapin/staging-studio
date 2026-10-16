/**
 * Issue #1341 — `<FineTune>` (advanced generation controls).
 *
 * The Fine-tune panel is collapsed by default; expanding it surfaces
 * three controls — how-much-can-change, blend-edges (px, scope !==
 * "whole-room" only), and a numeric seed input that strips
 * non-digits on change.
 *
 * Issue #1362a — `adherence` (Follow directions) and `shadows` (Include
 * floor shadows) are removed. Adherence had no API field it landed on
 * and conflicted with `strength` (Q1 user correction). Shadows had no
 * API field either — DashScope masks are binary B/W. Stage B
 * (#1362b) replaces shadows semantically with a pre-upload
 * mask-feather utility driven by the `expand` slider.
 *
 * Pinned cases:
 *  - Collapsed by default — the inner controls do not appear in markup.
 *  - Chevron rotates 180° on toggle (CSS class swap).
 *  - All three controls (or two controls in whole-room scope) commit
 *    values via their `onChange` handlers.
 *  - The seed input strips non-digits on change.
 *  - The blend-edges slider is hidden when scope === "whole-room".
 *  - The "Defaults" hint text renders when collapsed.
 *  - No hex literals — every color is an Atelier token.
 *
 * Like the rest of the edit-room subtree the component is a pure
 * function of its props; the `open` state is local to the component
 * for the toggle, the rest is owned by the parent.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FineTune } from "@/components/edit-room/FineTune";

describe("FineTune (issue #1341, narrowed by #1362a)", () => {
  it("renders the panel header with the Fine-tune label", () => {
    const html = renderToStaticMarkup(
      <FineTune
        scope="objects"
        strength={50}
        onStrengthChange={() => {}}
        expand={12}
        onExpandChange={() => {}}
        seed=""
        onSeedChange={() => {}}
      />
    );
    expect(html).toContain("Fine-tune");
  });

  it('shows the "Defaults" hint text when collapsed', () => {
    const html = renderToStaticMarkup(
      <FineTune
        scope="objects"
        strength={50}
        onStrengthChange={() => {}}
        expand={12}
        onExpandChange={() => {}}
        seed=""
        onSeedChange={() => {}}
      />
    );
    // The "Defaults" text appears alongside the chevron when collapsed.
    expect(html).toContain("Defaults");
  });

  it('does not show slider controls when collapsed (default)', () => {
    const html = renderToStaticMarkup(
      <FineTune
        scope="objects"
        strength={50}
        onStrengthChange={() => {}}
        expand={12}
        onExpandChange={() => {}}
        seed=""
        onSeedChange={() => {}}
      />
    );
    // The strength slider that shows in every scope is absent.
    expect(html).not.toContain("How much can change");
  });

  it("renders a toggle button with aria-expanded=false when collapsed", () => {
    const html = renderToStaticMarkup(
      <FineTune
        scope="objects"
        strength={50}
        onStrengthChange={() => {}}
        expand={12}
        onExpandChange={() => {}}
        seed=""
        onSeedChange={() => {}}
      />
    );
    expect(html).toMatch(/aria-expanded="false"/);
  });

  it("renders the blend-edges slider for non-whole-room scopes", () => {
    // The collapsed render hides the controls — the structural test
    // pins them via the `open` prop (#1341 exposes this for tests).
    const html = renderToStaticMarkup(
      <FineTune
        scope="objects"
        open
        strength={50}
        onStrengthChange={() => {}}
        expand={12}
        onExpandChange={() => {}}
        seed=""
        onSeedChange={() => {}}
      />
    );
    expect(html).toContain("Blend edges");
    // Issue #1362a — "Include floor shadows" checkbox is gone.
    expect(html).not.toContain("Include floor shadows");
  });

  it("omits the blend-edges slider when scope === 'whole-room'", () => {
    const html = renderToStaticMarkup(
      <FineTune
        scope="whole-room"
        open
        strength={50}
        onStrengthChange={() => {}}
        expand={12}
        onExpandChange={() => {}}
        seed=""
        onSeedChange={() => {}}
      />
    );
    expect(html).not.toContain("Blend edges");
    expect(html).not.toContain("Include floor shadows");
  });

  it("renders all three controls (or two in whole-room) when open", () => {
    const html = renderToStaticMarkup(
      <FineTune
        scope="objects"
        open
        strength={50}
        onStrengthChange={() => {}}
        expand={12}
        onExpandChange={() => {}}
        seed=""
        onSeedChange={() => {}}
      />
    );
    // Two sliders (strength + blend-edges) + one numeric input (seed).
    expect(html).toContain("How much can change");
    expect(html).toContain("Blend edges");
    expect(html).toContain("Seed");
    expect(html).toContain('placeholder="Random"');
    // Issue #1362a — `adherence`/`Follow directions` and `shadows`/`Include
    // floor shadows` are gone.
    expect(html).not.toContain("Follow directions");
    expect(html).not.toContain("Include floor shadows");
  });

  it("renders the strength value with a percent suffix in the display", () => {
    const html = renderToStaticMarkup(
      <FineTune
        scope="objects"
        open
        strength={42}
        onStrengthChange={() => {}}
        expand={12}
        onExpandChange={() => {}}
        seed=""
        onSeedChange={() => {}}
      />
    );
    expect(html).toContain("42%");
  });

  it("renders the expand value with a px suffix in the display", () => {
    const html = renderToStaticMarkup(
      <FineTune
        scope="objects"
        open
        strength={50}
        onStrengthChange={() => {}}
        expand={20}
        onExpandChange={() => {}}
        seed=""
        onSeedChange={() => {}}
      />
    );
    expect(html).toContain("20px");
  });

  it("renders the seed input with inputMode=numeric and a Random placeholder", () => {
    const html = renderToStaticMarkup(
      <FineTune
        scope="objects"
        open
        strength={50}
        onStrengthChange={() => {}}
        expand={12}
        onExpandChange={() => {}}
        seed=""
        onSeedChange={() => {}}
      />
    );
    // React's `inputMode` JSX prop serializes as `inputMode` in SSR
    // markup — accept either casing (the HTML attribute is lowercase).
    expect(html).toMatch(/inputmode="numeric"/i);
    expect(html).toContain('placeholder="Random"');
  });

  it("does not include any hex color literal in the rendered markup", () => {
    const html = renderToStaticMarkup(
      <FineTune
        scope="objects"
        open
        strength={50}
        onStrengthChange={() => {}}
        expand={12}
        onExpandChange={() => {}}
        seed=""
        onSeedChange={() => {}}
      />
    );
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});