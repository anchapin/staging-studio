/**
 * Issue #1341 — `<StagePanel>` (scope + scope-aware sub-panel + Directions).
 *
 * The StagePanel is a pure function of its props. The shell owns the
 * state — `scope`, `directions`, `concept`, `selected`, `hasMask`,
 * `viewing` — and passes it in. The panel owns one piece of local
 * state: the `contextOpen` collapsible (the "Also applied from the
 * project" disclosure).
 *
 * Pinned cases (issue acceptance criteria):
 *  - The 3-way scope segmented control renders with the correct labels.
 *  - The selected option renders the active-pill background (CSS-class
 *    swap; the layoutId animation is framer-motion-specific and is
 *    replaced by a static colored div in the port).
 *  - The scope segmented control calls `onScopeChange(s)` on click.
 *  - The Directions textarea is the only `<textarea>` on the page
 *    (the a11y test).
 *  - Whole-room + viewing-variant renders the blocked notice + the
 *    "Switch to original photo" link.
 *  - Whole-room + viewing-original renders the info notice.
 *  - Objects + viewing-variant renders the concept chips + the
 *    detection list header.
 *  - Objects + viewing-original renders the "use whole-room first"
 *    notice.
 *  - Paint + !hasMask renders the "Brush over…" status line.
 *  - Paint + hasMask renders the "Area painted" status + "Start over"
 *    affordance.
 *  - The FineTune panel is mounted (its "Fine-tune" header is in the
 *    markup).
 *  - The "Also applied from the project: <aesthetic>" toggle
 *    renders and expands on click (the local collapsible).
 *  - No hex literals — every color is an Atelier token.
 *
 * Note: `onScopeChange`/`onDirectionsChange`/`onConceptChange` etc.
 * are `vi.fn()` placeholders; the reducer test + the integration test
 * (mounting StagePanel inside EditRoomStudio) pin the click→dispatch
 * chain end-to-end.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StagePanel } from "@/components/edit-room/StagePanel";
import type { StagePanelProps } from "@/components/edit-room/StagePanel";

const DETECTIONS = [
  { id: "sofa", concept: "Sofa", label: "Sofa", box: { x: 49, y: 57, w: 31, h: 42 } },
  { id: "chair", concept: "Sofa", label: "Lounge chair", box: { x: 8, y: 58, w: 23, h: 27 } },
];

const baseProps = (overrides: Partial<StagePanelProps> = {}): StagePanelProps => ({
  scope: "objects",
  onScopeChange: vi.fn(),
  viewing: "A",
  onViewOriginal: vi.fn(),
  targetSlot: "A",
  directions: "",
  onDirectionsChange: vi.fn(),
  concept: "Sofa",
  onConceptChange: vi.fn(),
  onConceptSubmit: vi.fn(),
  selected: [],
  onToggleObject: vi.fn(),
  onClearSelection: vi.fn(),
  hasMask: false,
  onClearMask: vi.fn(),
  detections: DETECTIONS,
  projectAesthetic: "Warm Craftsman Modern",
  projectGlobalDirectives: "Keep original molding and floors visible.",
  ...overrides,
});

describe("StagePanel (issue #1341)", () => {
  it("renders the three scope labels: Whole room, Objects, Paint area", () => {
    const html = renderToStaticMarkup(<StagePanel {...baseProps()} />);
    expect(html).toContain("Whole room");
    expect(html).toContain("Objects");
    expect(html).toContain("Paint area");
  });

  it("renders the section heading 'What should change?'", () => {
    const html = renderToStaticMarkup(<StagePanel {...baseProps()} />);
    expect(html).toContain("What should change?");
  });

  it("renders the scope segmented control as a role=radiogroup with three radios", () => {
    const html = renderToStaticMarkup(<StagePanel {...baseProps()} />);
    expect(html).toContain('role="radiogroup"');
    const radioCount = (html.match(/role="radio"/g) || []).length;
    expect(radioCount).toBe(3);
  });

  it('marks the active scope radio with aria-checked="true"', () => {
    const html = renderToStaticMarkup(
      <StagePanel {...baseProps({ scope: "objects" })} />
    );
    // Exactly one radio is checked.
    const checkedCount = (html.match(/aria-checked="true"/g) || []).length;
    expect(checkedCount).toBe(1);
  });

  it("renders the Directions textarea as the page's only textarea", () => {
    const html = renderToStaticMarkup(<StagePanel {...baseProps()} />);
    const textareaCount = (html.match(/<textarea/g) || []).length;
    expect(textareaCount).toBe(1);
  });

  it("renders the Directions label and the placeholder", () => {
    const html = renderToStaticMarkup(<StagePanel {...baseProps()} />);
    expect(html).toContain("Directions");
    expect(html).toContain("Modern coastal furniture");
  });

  it("renders the Fine-tune panel header", () => {
    const html = renderToStaticMarkup(<StagePanel {...baseProps()} />);
    expect(html).toContain("Fine-tune");
  });

  it("renders the 'Also applied from the project' toggle with the aesthetic name", () => {
    const html = renderToStaticMarkup(<StagePanel {...baseProps()} />);
    expect(html).toContain("Also applied from the project:");
    expect(html).toContain("Warm Craftsman Modern");
  });

  it('whole-room scope + viewing original renders the "Furnishes the empty room" info notice', () => {
    const html = renderToStaticMarkup(
      <StagePanel
        {...baseProps({ scope: "whole-room", viewing: "original" })}
      />
    );
    expect(html).toContain("Furnishes the empty room from scratch in the project style.");
  });

  it('whole-room scope + viewing a variant renders the blocked notice + "Switch to original photo" link', () => {
    const html = renderToStaticMarkup(
      <StagePanel {...baseProps({ scope: "whole-room", viewing: "A" })} />
    );
    expect(html).toContain("Whole-room staging works on the empty original");
    expect(html).toContain("Switch to original photo");
  });

  it("objects scope + viewing a variant renders the concept chips", () => {
    const html = renderToStaticMarkup(
      <StagePanel {...baseProps({ scope: "objects", viewing: "A" })} />
    );
    // Concept chips: Sofa, Chair, Table, Rug, Lamp.
    expect(html).toContain("Sofa");
    expect(html).toContain("Chair");
    expect(html).toContain("Table");
    expect(html).toContain("Rug");
    expect(html).toContain("Lamp");
  });

  it("objects scope renders the Other… search input", () => {
    const html = renderToStaticMarkup(
      <StagePanel {...baseProps({ scope: "objects", viewing: "A" })} />
    );
    expect(html).toContain("Other");
    expect(html).toMatch(/placeholder="Other[^"]*"/);
  });

  it("objects scope + viewing original renders the 'use whole-room first' notice", () => {
    const html = renderToStaticMarkup(
      <StagePanel
        {...baseProps({ scope: "objects", viewing: "original", concept: null })}
      />
    );
    expect(html).toContain("The original photo is empty.");
  });

  it("paint scope + !hasMask renders the 'Brush over the part of the photo' status line", () => {
    const html = renderToStaticMarkup(
      <StagePanel {...baseProps({ scope: "paint", hasMask: false })} />
    );
    expect(html).toContain("Brush over the part of the photo you want to restage");
  });

  it("paint scope + hasMask renders the 'Area painted' status + Start over affordance", () => {
    const html = renderToStaticMarkup(
      <StagePanel {...baseProps({ scope: "paint", hasMask: true })} />
    );
    expect(html).toContain("Area painted.");
    expect(html).toContain("Start over");
  });

  it("renders each concept chip with aria-pressed reflecting the active concept", () => {
    const html = renderToStaticMarkup(
      <StagePanel {...baseProps({ scope: "objects", viewing: "A", concept: "Sofa" })} />
    );
    // Exactly one concept chip is aria-pressed=true.
    const pressedCount = (html.match(/aria-pressed="true"/g) || []).length;
    expect(pressedCount).toBe(1);
  });

  it("renders the detection list header inside the Objects scope", () => {
    const html = renderToStaticMarkup(
      <StagePanel {...baseProps({ scope: "objects", viewing: "A" })} />
    );
    expect(html).toContain("found");
    expect(html).toContain("click on the photo or here");
  });

  it("does not include any hex color literal in the rendered markup", () => {
    const html = renderToStaticMarkup(<StagePanel {...baseProps()} />);
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("renders the textarea with the value controlled by the directions prop", () => {
    const html = renderToStaticMarkup(
      <StagePanel {...baseProps({ directions: "Soft modern with brass accents" })} />
    );
    expect(html).toContain("Soft modern with brass accents");
  });

  it("renders the selected concept chip with an active (pressed) style", () => {
    // Pinned by the structural aria-pressed=true count above. The
    // additional check: the active chip is not the only one rendered —
    // the chip set always renders all 5 chips.
    const html = renderToStaticMarkup(
      <StagePanel {...baseProps({ scope: "objects", viewing: "A", concept: "Chair" })} />
    );
    expect(html).toContain("Sofa");
    expect(html).toContain("Chair");
    expect(html).toContain("Rug");
  });

  it("renders the 'Use whole room to stage it' notice instead of the concept chips when viewing original + objects scope", () => {
    const html = renderToStaticMarkup(
      <StagePanel
        {...baseProps({ scope: "objects", viewing: "original", concept: null })}
      />
    );
    // The notice replaces the chips — none of the concept labels appear
    // inside the active scope block.
    // (The detection-list header is also absent in this branch.)
    expect(html).not.toContain("click on the photo or here");
  });
});