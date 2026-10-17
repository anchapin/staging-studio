/**
 * Issue #1342 — `<EditRoomStudio>` shell mount of `<Inspector>`.
 *
 * The component-level test (`tests/edit-room-inspector.test.tsx`)
 * exercises the Inspector in isolation. This test pins the shell +
 * Inspector wiring: the shell mounts the Inspector in the inspector
 * slot (`<aside data-testid="edit-room-inspector">`) and the shell's
 * reducer state drives the tab strip, the StagePanel mount, and the
 * Run button's label + helper text + disabled state.
 *
 * The shell's reducer is the SSOT for `scope`/`concept`/`directions`/
 * `selected`/`hasMask`/`viewing`; the Inspector is a pure render of
 * those values + a few shell-owned `useState` slots (`activeTab`,
 * fineTune five controls). End-to-end click→dispatch→inspector-rerender
 * is pinned by the reducer test together with this mount test.
 *
 * `next/navigation` is mocked because `renderToStaticMarkup` runs in
 * the node env without an actual App Router; `useRouter()` throws
 * "invariant expected app router to be mounted" otherwise.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { EditRoomStudio } from "@/components/edit-room/EditRoomStudio";
import { baseProps } from "./edit-room-studio-fixture";

describe("EditRoomStudio mounts <Inspector> (issue #1342)", () => {
  it("renders the Inspector (data-testid=edit-room-inspector) in the right column", () => {
    const html = renderToStaticMarkup(<EditRoomStudio {...baseProps()} />);
    expect(html).toContain('data-testid="edit-room-inspector"');
    // The Inspector's tab strip lives inside.
    expect(html).toContain('role="tablist"');
  });

  it("renders the Staging tab as the active tab on initial render", () => {
    const html = renderToStaticMarkup(<EditRoomStudio {...baseProps()} />);
    expect(html).toContain("Staging");
    expect(html).toContain("Listing copy");
    // The Staging tab carries `aria-selected="true"` on initial
    // render (Inspector state defaults to "stage"). Pin by extracting
    // the tab button tag (the inspector-tab-* data-testid is unique
    // to the Inspector's tab strip).
    const tabMatch = html.match(/<button[^>]*data-testid="inspector-tab-stage"[^>]*>/);
    expect(tabMatch).not.toBeNull();
    expect(tabMatch![0]).toMatch(/aria-selected="true"/);
    // The Listing copy tab is the inactive one.
    const copyMatch = html.match(/<button[^>]*data-testid="inspector-tab-copy"[^>]*>/);
    expect(copyMatch).not.toBeNull();
    expect(copyMatch![0]).toMatch(/aria-selected="false"/);
  });

  it("renders the Run button (data-testid=run-button) below the StagePanel", () => {
    const html = renderToStaticMarkup(<EditRoomStudio {...baseProps()} />);
    expect(html).toContain('data-testid="run-button"');
  });

  it("renders the Run button disabled on initial render (no directions → blocked)", () => {
    // The blocked resolver returns "Add directions so the AI knows what
    // to stage." when hasDirections is false. The shell wires that
    // through to the Inspector as `blockedReason`, which forwards it
    // to the Run button's `disabled` flag.
    const html = renderToStaticMarkup(<EditRoomStudio {...baseProps()} />);
    const buttonMatch = html.match(/<button[^>]*data-testid="run-button"[^>]*>/);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch![0]).toMatch(/\sdisabled(=|>)/);
  });

  it("renders the helper text under the Run button", () => {
    const html = renderToStaticMarkup(<EditRoomStudio {...baseProps()} />);
    expect(html).toContain('data-testid="run-helper-text"');
    // Initial state: blocked=Add directions…
    expect(html).toContain("Add directions");
  });

  it("renders the StagePanel inside the Inspector when Staging tab is active", () => {
    const html = renderToStaticMarkup(<EditRoomStudio {...baseProps()} />);
    expect(html).toContain("What should change?");
    // The Fine-tune panel is part of the StagePanel subtree.
    expect(html).toContain("Fine-tune");
  });

  it("does not import or mount anything from @/components/canvas/*", () => {
    // The shell + Inspector + StagePanel + FineTune subtree is
    // independent of the legacy canvas surface until #1346 deletes the
    // legacy tab triple. This static check confirms the integration
    // test would notice any future regression.
    const html = renderToStaticMarkup(<EditRoomStudio {...baseProps()} />);
    expect(html).not.toContain("detect-tab-panel");
    expect(html).not.toContain("editor-tab-bar");
  });
});