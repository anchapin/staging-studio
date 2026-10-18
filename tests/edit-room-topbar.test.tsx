import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TopBar } from "@/components/edit-room/TopBar";

// Issue #1338 acceptance criteria:
//  - TopBar renders with the Atelier palette
//  - listbox trigger has aria-haspopup="listbox" + aria-expanded
//  - breadcrumb shows "address / room.name"
//  - Preview lookbook renders as an anchor with the right href
//  - All rooms button fires onExitToProject exactly once per click
//
// Component-interaction tests (keyboard navigation of the listbox,
// fake-timer save-status flip) land with the route wiring (#1344/#1345)
// so they can use Playwright's e2e specs (per AGENTS.md "Testing").
// This test pins the structural + prop wiring that the next slice
// (CanvasStage #1339) and the wire-up slices depend on.

const baseProps = () => ({
  address: "418 Linden Ave",
  roomName: "Living Room",
  projectId: "proj-1",
  roomId: "living",
  saveStatus: "saved" as const,
  onRoomChange: () => {},
  onExitToProject: () => {},
});

describe("TopBar", () => {
  it("renders the address + room name in the breadcrumb", () => {
    const html = renderToStaticMarkup(<TopBar {...baseProps()} />);
    expect(html).toContain("418 Linden Ave");
    expect(html).toContain("Living Room");
  });

  it("renders the room picker trigger with aria-haspopup=listbox and aria-expanded=false", () => {
    const html = renderToStaticMarkup(<TopBar {...baseProps()} />);
    // The Magic Patterns design wraps the picker in a listbox; the
    // trigger must expose the role attrs so the e2e spec can target it
    // without a CSS selector.
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("renders the 'Saved' indicator when saveStatus='saved'", () => {
    const html = renderToStaticMarkup(
      <TopBar {...baseProps()} saveStatus="saved" />
    );
    expect(html).toContain("Saved");
  });

  it("renders the 'Saving' indicator (with animate-spin) when saveStatus='saving'", () => {
    const html = renderToStaticMarkup(
      <TopBar {...baseProps()} saveStatus="saving" />
    );
    expect(html).toContain("Saving");
    expect(html).toContain("animate-spin");
  });

  it("renders the 'Preview lookbook' button as an anchor with the project lookbook href", () => {
    const html = renderToStaticMarkup(<TopBar {...baseProps()} />);
    // <Link> renders an <a> with the project lookbook href. We assert
    // the href format (and that no <button> stands in) so a future
    // refactor to <button> + onClick doesn't slip through.
    expect(html).toContain('href="/projects/proj-1/lookbook"');
    expect(html).toContain("Preview lookbook");
    expect(html).toMatch(/<a[^>]*href="\/projects\/proj-1\/lookbook"/);
  });

  it("renders the 'All rooms' button with the exit callback wired", () => {
    // Static render can't observe the callback firing (no events on
    // server-rendered HTML), but we CAN assert the button is present
    // and labelled correctly. The "fires once per click" behavior is
    // pinned by the Playwright spec in #1344 (out of scope here).
    const html = renderToStaticMarkup(<TopBar {...baseProps()} />);
    expect(html).toContain("All rooms");
    expect(html).toContain('aria-label="Exit to all rooms"');
  });

  it("uses Atelier palette tokens (no raw hex literals)", () => {
    const html = renderToStaticMarkup(<TopBar {...baseProps()} />);
    // Defense-in-depth: a hex literal in the rendered HTML would imply
    // a missing token reference (color-tokens.ts is the SSOT).
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("renders with a tightened header height (h-12 = 48px) — issue #1374", () => {
    // Page + room-studio sub-header must fit ≤15% of a 1920×932 viewport
    // (~140px). The TopBar was `h-14` (56px); tightening to `h-12` (48px)
    // is the small piece the TopBar can contribute to that budget.
    // Don't accept any other `h-1N` so a future revert to `h-14` (or a
    // case like `h-20`) trips this test before shipping.
    const html = renderToStaticMarkup(<TopBar {...baseProps()} />);
    expect(html).toContain("h-12");
    expect(html).not.toMatch(/\bh-1[3-9]\b/);
    expect(html).not.toMatch(/\bh-[2-9]\d\b/);
  });
});