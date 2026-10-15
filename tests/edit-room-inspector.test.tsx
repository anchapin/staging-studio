/**
 * Issue #1342 — `<Inspector>` (380px right column shell).
 *
 * The Inspector wraps the two-tab tab strip + the StagePanel
 * (Staging tab) + a stub CopyPanel (Listing copy tab) + the primary
 * Run button footer. It is a pure function of props — the shell
 * (EditRoomStudio) owns all state via `useReducer` and threads the
 * derived values down.
 *
 * Pinned cases (per the issue body):
 *  - 380px right column (`<aside>`).
 *  - Two-tab tab strip with `role="tablist"`, each tab is a real
 *    `<button role="tab">` with `aria-selected` reflecting the active
 *    tab.
 *  - The Staging tab mounts the StagePanel; the Listing copy tab
 *    mounts the CopyPanel stub.
 *  - The active tab carries a 2px walnut underline (`data-testid` for
 *    stable e2e targeting).
 *  - Clicking a tab fires `onTabChange(tab)` (controlled mode).
 *  - The Run button footer renders below the tab panel.
 *  - The Run button fires `onRun()` on click.
 *  - The Run button is disabled when the blocked resolver returns a
 *    string — pinned across 8 (scope, viewing, hasMask, hasSelection,
 *    hasDirections) combinations via the parent's test (see
 *    `tests/edit-room-blocked.test.ts`).
 *  - The Inspector renders the helper text under the Run button.
 *  - axe a11y: real roles, `aria-selected`, accessible name on the
 *    Run button (the label).
 *  - No hex literals — every color is an Atelier token.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Inspector } from "@/components/edit-room/Inspector";

const baseProps = (overrides: Partial<Parameters<typeof Inspector>[0]> = {}) => ({
  scope: "whole-room" as const,
  viewing: "original" as const,
  targetSlot: "A" as const,
  directions: "",
  concept: null as string | null,
  selected: [] as ReadonlyArray<string>,
  hasMask: false,
  blockedReason: null as string | null,
  isRunning: false,
  progress: 0,
  onScopeChange: vi.fn(),
  onViewOriginal: vi.fn(),
  onDirectionsChange: vi.fn(),
  onConceptChange: vi.fn(),
  onConceptSubmit: vi.fn(),
  onToggleObject: vi.fn(),
  onClearSelection: vi.fn(),
  onClearMask: vi.fn(),
  detections: [],
  projectAesthetic: "Warm Craftsman Modern",
  projectGlobalDirectives: "Keep original molding visible.",
  activeTab: "stage" as const,
  onTabChange: vi.fn(),
  onRun: vi.fn(),
  // #1343 — CopyPanel (Listing copy tab) inputs.
  copyHeadline: "",
  copyBody: "",
  isCopyRewriting: false,
  onCopyHeadlineChange: vi.fn(),
  onCopyBodyChange: vi.fn(),
  onCopyRewrite: vi.fn(),
  ...overrides,
});

describe("Inspector (issue #1342)", () => {
  it("renders a 380px right-column <aside>", () => {
    const html = renderToStaticMarkup(<Inspector {...baseProps()} />);
    expect(html).toMatch(/<aside[^>]*w-\[380px\]/);
  });

  it("renders a tablist with two tabs (Staging + Listing copy)", () => {
    const html = renderToStaticMarkup(<Inspector {...baseProps()} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Editor sections"');
    expect(html).toContain("Staging");
    expect(html).toContain("Listing copy");
    const tabCount = (html.match(/role="tab"/g) || []).length;
    expect(tabCount).toBe(2);
  });

  it("marks the active tab with aria-selected=true (and the inactive with aria-selected=false)", () => {
    const html = renderToStaticMarkup(
      <Inspector {...baseProps({ activeTab: "copy" })} />
    );
    const trueCount = (html.match(/aria-selected="true"/g) || []).length;
    const falseCount = (html.match(/aria-selected="false"/g) || []).length;
    expect(trueCount).toBe(1);
    expect(falseCount).toBe(1);
  });

  it("renders the StagePanel when activeTab='stage' (heading 'What should change?' is present)", () => {
    const html = renderToStaticMarkup(
      <Inspector {...baseProps({ activeTab: "stage" })} />
    );
    expect(html).toContain("What should change?");
  });

  it("does NOT render the StagePanel when activeTab='copy'", () => {
    const html = renderToStaticMarkup(
      <Inspector {...baseProps({ activeTab: "copy" })} />
    );
    expect(html).not.toContain("What should change?");
  });

  it("renders the CopyPanel (Listing copy tab) when activeTab='copy'", () => {
    // #1343 replaced the stub: the panel now renders the Headline
    // input + Description textarea + Rewrite CTA. Pinned by string
    // match against the panel's own header (`Listing copy`) and
    // the Rewrite CTA label — the absence of any "coming soon"
    // marker proves the stub is gone.
    const html = renderToStaticMarkup(
      <Inspector {...baseProps({ activeTab: "copy" })} />
    );
    expect(html).toContain('data-testid="copy-panel"');
    expect(html).toContain('id="copy-headline"');
    expect(html).toContain('id="copy-body"');
    expect(html).toContain("Rewrite from directions");
    expect(html).not.toContain("coming soon");
  });

  it("renders the Run button (data-testid=run-button) below the tab panel", () => {
    const html = renderToStaticMarkup(<Inspector {...baseProps()} />);
    expect(html).toContain('data-testid="run-button"');
  });

  it("renders the helper text below the Run button (data-testid=run-helper-text)", () => {
    const html = renderToStaticMarkup(<Inspector {...baseProps()} />);
    expect(html).toContain('data-testid="run-helper-text"');
  });

  it("does not render the Run button when activeTab='copy' (the staging footer is staging-only)", () => {
    // The CopyPanel has its own footer in the design — when the
    // Listing copy tab is active, the Inspector's staging footer is
    // hidden so the two footers don't stack.
    const html = renderToStaticMarkup(
      <Inspector {...baseProps({ activeTab: "copy" })} />
    );
    expect(html).not.toContain('data-testid="run-button"');
    expect(html).not.toContain('data-testid="run-helper-text"');
  });

  it("the Staging-tab Inspector carries a footer data-testid for the staging footer", () => {
    const html = renderToStaticMarkup(
      <Inspector {...baseProps({ activeTab: "stage" })} />
    );
    expect(html).toContain('data-testid="inspector-staging-footer"');
  });

  it("the Copy-tab Inspector carries a footer data-testid for the copy footer (placeholder for #1343)", () => {
    const html = renderToStaticMarkup(
      <Inspector {...baseProps({ activeTab: "copy" })} />
    );
    expect(html).toContain('data-testid="inspector-copy-footer"');
  });

  it("does not include any hex color literal in the rendered markup", () => {
    const html = renderToStaticMarkup(<Inspector {...baseProps()} />);
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("passes scope/viewing/hasMask/hasDirections through to the StagePanel's blocked-reason-driven Run state", () => {
    // The Inspector's blockedResolver wires scope/viewing/hasMask/
    // selectedCount/hasDirections → blocked reason → Run button
    // disabled. The unit-level coverage of every blocked branch lives
    // in tests/edit-room-blocked.test.ts; this is the wiring smoke
    // test (disabled prop is forwarded).
    const html = renderToStaticMarkup(
      <Inspector
        {...baseProps({
          scope: "objects",
          viewing: "original", // blocked branch: original + objects
          blockedReason: "The original photo is empty — there are no objects to pick.",
        })}
      />
    );
    // The Run button is rendered AND disabled (button carries the
    // `disabled` HTML attribute when the parent passes disabled=true).
    expect(html).toContain('data-testid="run-button"');
    const buttonMatch = html.match(/<button[^>]*data-testid="run-button"[^>]*>/);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch![0]).toMatch(/\sdisabled(=|>)/);
    expect(html).toContain("The original photo is empty");
  });

  it("does not disable the Run button when blockedReason=null", () => {
    const html = renderToStaticMarkup(
      <Inspector {...baseProps({ blockedReason: null })} />
    );
    // The Run button has no `disabled` HTML attribute (the parent
    // never passed disabled=true). Pin by extracting the run-button
    // tag and asserting no ` disabled` token appears as an attribute
    // (the `disabled:bg-...` Tailwind variants live in `class=` so
    // they don't trip a boundary match).
    const buttonMatch = html.match(/<button[^>]*data-testid="run-button"[^>]*>/);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch![0]).not.toMatch(/\sdisabled(=|>)/);
  });
});