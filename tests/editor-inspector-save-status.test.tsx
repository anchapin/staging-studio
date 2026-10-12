import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorInspectorColumn } from "@/components/canvas/editor-inspector-column";

// Issue #1155: the saveStatus chip in the inspector is driven by the prop the
// parent passes (the room's directive autosave controller status), not the
// deleted orphan registry. Pin the visible contract.

vi.mock("@/components/canvas/collapsible-section", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/canvas/editor-tab-bar", () => ({ default: () => null }));
vi.mock("@/components/canvas/entire-tab-panel", () => ({ default: () => null }));
vi.mock("@/components/canvas/manual-tab-panel", () => ({ default: () => null }));
vi.mock("@/components/canvas/detect-tab-panel", () => ({ default: () => null }));
vi.mock("@/components/canvas/inspector-header", () => ({ default: () => null }));
vi.mock("@/components/canvas/inspector-collapsed-rail", () => ({ default: () => null }));
vi.mock("@/components/canvas/inspector-footer-panels", () => ({ default: () => null }));
vi.mock("@/components/canvas/source-selector-fieldset", () => ({ default: () => null }));

const baseProps = {
  inspectorView: "expanded",
  inspectorPanel: { isCollapsed: false, toggle: () => {} },
  brushPanel: { isCollapsed: false, toggle: () => {} },
  sourceOptions: [],
  editorTabs: [],
  effectiveTab: "entire",
  conceptSegments: { status: "idle" },
};

describe("EditorInspectorColumn saveStatus prop (issue #1155)", () => {
  it("shows the saving indicator while the parent reports saving", () => {
    const html = renderToStaticMarkup(
      createElement(EditorInspectorColumn, { ...baseProps, saveStatus: "saving" }),
    );
    expect(html).toContain("Saving...");
  });

  it("shows the saved indicator while the parent reports saved", () => {
    const html = renderToStaticMarkup(
      createElement(EditorInspectorColumn, { ...baseProps, saveStatus: "saved" }),
    );
    expect(html).toContain("Saved");
  });

  it("shows nothing while idle", () => {
    const html = renderToStaticMarkup(
      createElement(EditorInspectorColumn, { ...baseProps, saveStatus: "idle" }),
    );
    expect(html).not.toContain("Saving...");
    expect(html).not.toContain("Saved");
  });
});
