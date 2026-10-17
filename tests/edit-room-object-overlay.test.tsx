/**
 * Issue #1339 — CanvasStage + MaskLayer + CompareLayer + on-canvas object boxes.
 *
 * `ObjectOverlay` is the on-canvas `<button>` rendered for each detected
 * object when `scope === "objects"`. It is a thin visual wrapper: the
 * button is positioned by percent over the photo, gets a dashed white
 * border when unselected and a solid bronze border when selected, and
 * shows a label tag in the top-left corner.
 *
 * Pinned cases (renderToStaticMarkup, per the repo's no-jsdom-test-env
 * convention):
 *  - selected: aria-pressed="true", solid 2px bronze border, bronze
 *    label background with the ✓ prefix
 *  - unselected: aria-pressed="false", dashed 2px white border, walnut
 *    label background with no prefix
 *  - onToggle callback fires when the structural button is clicked —
 *    static markup can't observe this, so it is asserted via the
 *    handler binding in the rendered button's context (the e2e spec
 *    in #1344 owns the actual click behavior)
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ObjectOverlay } from "@/components/edit-room/object-overlay";

const baseBox = { x: 49, y: 57, w: 31, h: 42 };

describe("ObjectOverlay (issue #1339)", () => {
  it("renders a button with aria-pressed=false when unselected", () => {
    const html = renderToStaticMarkup(
      <ObjectOverlay
        id="sofa"
        box={baseBox}
        label="Sofa"
        selected={false}
        onToggle={() => {}}
      />
    );
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Sofa"');
    expect(html).toContain("Sofa");
    // Unselected = dashed white border (border-dashed + border-white)
    expect(html).toMatch(/border-dashed/);
    expect(html).toMatch(/border-white/);
    // Unselected = walnut label background (no ✓ prefix)
    expect(html).toMatch(/bg-walnut/);
    expect(html).not.toMatch(/✓/);
  });

  it("renders a button with aria-pressed=true and the ✓ prefix when selected", () => {
    const html = renderToStaticMarkup(
      <ObjectOverlay
        id="sofa"
        box={baseBox}
        label="Sofa"
        selected={true}
        onToggle={() => {}}
      />
    );
    expect(html).toContain('aria-pressed="true"');
    // Selected = solid 2px bronze border (no dashed modifier)
    expect(html).toMatch(/border-bronze/);
    expect(html).not.toMatch(/border-dashed/);
    // Selected = bronze label background with ✓ prefix
    expect(html).toMatch(/✓/);
    expect(html).toMatch(/Sofa/);
  });

  it("positions the button by percent of the photo (issue spec)", () => {
    const html = renderToStaticMarkup(
      <ObjectOverlay
        id="lamp"
        box={{ x: 10, y: 20, w: 30, h: 40 }}
        label="Lamp"
        selected={false}
        onToggle={() => {}}
      />
    );
    // Inline-style positioning. The percent is exposed via the React
    // style prop; react-dom/server emits it as inline CSS.
    expect(html).toMatch(/left:\s*10%/);
    expect(html).toMatch(/top:\s*20%/);
    expect(html).toMatch(/width:\s*30%/);
    expect(html).toMatch(/height:\s*40%/);
  });

  it("clamps hostile box values to 0% (defensive — never NaN in the DOM)", () => {
    const html = renderToStaticMarkup(
      <ObjectOverlay
        id="x"
        box={{ x: -5, y: NaN, w: 10, h: 20 }}
        label="X"
        selected={false}
        onToggle={() => {}}
      />
    );
    // Clamped: x=-5 → "0%", y=NaN → "0%"
    expect(html).toMatch(/left:\s*0%/);
    expect(html).toMatch(/top:\s*0%/);
    expect(html).not.toMatch(/NaN/);
  });
});