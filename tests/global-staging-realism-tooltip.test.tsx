import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GlobalStagingDirectivesBar from "@/components/canvas/global-staging-directives-bar";

// Issue #1193: the Realism & Lighting slider needs an accessible tooltip
// that says plainly what the dial does (and, per the trace in the issue,
// that it is not yet wired to generation).

const PROPS = {
  aesthetic: "",
  onAestheticChange: () => {},
  lockedElements: [],
  onAddLock: () => {},
  onRemoveLock: () => {},
  realismValue: 82,
  onRealismChange: () => {},
  roomCount: 3,
  renderingCount: 0,
  gpuActive: false,
};

describe("Realism & Lighting slider tooltip (issue #1193)", () => {
  it("slider carries aria-describedby pointing at the tooltip description", () => {
    const html = renderToStaticMarkup(createElement(GlobalStagingDirectivesBar, PROPS));
    expect(html).toContain('aria-describedby="realism-info-desc"');
  });

  it("description element exists in the DOM (sr-only when closed) so the aria reference resolves", () => {
    const html = renderToStaticMarkup(createElement(GlobalStagingDirectivesBar, PROPS));
    expect(html).toContain('id="realism-info-desc"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("sr-only");
  });

  it("info button is keyboard-reachable and announces itself", () => {
    const html = renderToStaticMarkup(createElement(GlobalStagingDirectivesBar, PROPS));
    expect(html).toContain('aria-label="About the Realism and Lighting slider"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("tooltip copy describes the intended scale and discloses that the dial is not wired to generation", () => {
    const html = renderToStaticMarkup(createElement(GlobalStagingDirectivesBar, PROPS));
    expect(html).toContain("Not wired to generation yet");
    expect(html).toContain("lower is more stylized");
  });
});
