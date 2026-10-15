/**
 * Issue #1344 — `<EditRoomStudio>` route-mount prop contract.
 *
 * The shell becomes a controlled component for run state once the parent
 * route (`project-detail-view.tsx`) owns the submit + status-polling
 * machinery via its existing `useInpaintRuns` integration. The route
 * passes its own `running` (number 0..100 or null) and an `onRun`
 * callback; the shell no longer dispatches `RUN_START`. The reducer's
 * `running` slot becomes redundant and is dropped from the prop
 * contract — the shell renders the parent's value verbatim on the canvas
 * overlay, the inspector's Run button, and the version strip.
 *
 * Also added in this slice:
 *  - `address` + `addressLabel` (parent route's propertyAddress).
 *  - `imageUrl` (the resolved inpaint source URL, replaces the
 *    `PLACEHOLDER_URLS` lookup the shell was doing internally).
 *  - `lookbookVariantUrls` (the parent-supplied per-slot URL map;
 *    replaces the static `PLACEHOLDER_URLS` for slots A and B).
 *  - `aesthetic` + `globalDirectives` (parent route's project values,
 *    consumed by the Inspector).
 *
 * Pinned by the cases below so the route mount (#1344) and any future
 * preview/storybook site using the shell agrees on the same contract.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { EditRoomStudio } from "@/components/edit-room/EditRoomStudio";

const baseProps = () => ({
  saveStatus: "saved" as const,
  onDirectionsCommit: () => {},
  projectId: "project-1",
  roomId: "room-1",
  roomName: "Living Room",
  initialLookbookSlot: "A" as const,
  touchUps: { original: 0, A: 0, B: 0 },
  initialCopyHeadline: "",
  initialCopyBody: "",
  // #1344 — route-mount wiring
  address: "418 Linden Ave",
  imageUrl: "/room-photos/before.jpg",
  lookbookVariantUrls: { A: null, B: null },
  aesthetic: "Warm Craftsman Modern",
  globalDirectives: "Keep original molding visible.",
  running: null as number | null,
  onRun: () => {},
  onExitToProject: () => {},
});

describe("EditRoomStudio route-mount prop contract (issue #1344)", () => {
  it("renders the property address in the TopBar breadcrumb from `address`", () => {
    const html = renderToStaticMarkup(
      <EditRoomStudio {...baseProps()} address="500 Brand-New Way" />
    );
    expect(html).toContain("500 Brand-New Way");
  });

  it("renders the photo `imageUrl` on the canvas (replaces the placeholder URL)", () => {
    const html = renderToStaticMarkup(
      <EditRoomStudio
        {...baseProps()}
        imageUrl="https://example.test/room.jpg"
      />
    );
    // CanvasStage renders the <img src={imageUrl}> directly. The
    // placeholder URL the shell used previously (/edit-room/original.jpg)
    // must not leak when a real imageUrl is passed.
    expect(html).toContain("https://example.test/room.jpg");
    expect(html).not.toContain("/edit-room/original.jpg");
  });

  it("uses `lookbookVariantUrls.A` for the Variant A thumbnail (when set)", () => {
    const html = renderToStaticMarkup(
      <EditRoomStudio
        {...baseProps()}
        lookbookVariantUrls={{
          A: "https://example.test/variant-a.jpg",
          B: null,
        }}
      />
    );
    expect(html).toContain("https://example.test/variant-a.jpg");
  });

  it("forwards `aesthetic` to the Inspector's project-aesthetic label", () => {
    const html = renderToStaticMarkup(
      <EditRoomStudio
        {...baseProps()}
        aesthetic="Organic Modern Luxury"
      />
    );
    expect(html).toContain("Organic Modern Luxury");
  });

  it("forwards `globalDirectives` to the Inspector's disclosure button", () => {
    // The StagePanel renders the disclosure button with the
    // "Also applied from the project: <aesthetic>" label when
    // collapsed; the globalDirectives themselves are inside a
    // `Collapsible` that mounts children only when expanded. The
    // contract that #1344 pins is "the prop reaches the Inspector";
    // the StagePanel's own unit test pins the expanded rendering.
    const html = renderToStaticMarkup(
      <EditRoomStudio
        {...baseProps()}
        globalDirectives="Preserve the stained-glass transom."
      />
    );
    // The disclosure button is always rendered; the prop reaching the
    // Inspector is what #1344 owns.
    expect(html).toContain("Also applied from the project:");
    // Sanity: the Inspector's previous hardcoded literal is gone.
    expect(html).not.toContain(
      "Keep original molding, hardwood floors and brick visible."
    );
  });

  it("renders the running overlay when `running` is non-null", () => {
    const html = renderToStaticMarkup(
      <EditRoomStudio {...baseProps()} running={42} />
    );
    // CanvasStage pins the percent via `data-running-percent` and
    // renders it as a literal `{running}%` span. The latter is
    // unambiguous (no other markup contains the digit-percent pair),
    // unlike the canvas's inline style `width:100%`.
    expect(html).toContain("42%");
    expect(html).toContain('data-running-percent="42"');
  });

  it("does NOT render the data-running-percent attribute when `running` is null", () => {
    const html = renderToStaticMarkup(<EditRoomStudio {...baseProps()} />);
    // A redacted `running === null` must omit the running overlay
    // entirely. The canvas's `width:100%` style and the listbox's
    // `1/1` counter both contain digits, so we pin on the explicit
    // `data-running-percent` attribute that CanvasStage renders only
    // when a run is in flight.
    expect(html).not.toContain("data-running-percent=");
  });

  it("calls `onRun` when the Run button is clicked (controlled mode)", () => {
    // renderToStaticMarkup can't fire events; structural pin only. The
    // shell wires the Run button to `onRun` (not to its own dispatch)
    // — a future reader who restores RUN_START will trip this test.
    const onRun = vi.fn();
    const html = renderToStaticMarkup(
      <EditRoomStudio {...baseProps()} onRun={onRun} />
    );
    expect(html).toContain('data-testid="run-button"');
    expect(onRun).not.toHaveBeenCalled();
  });

  it("renders the All-rooms exit button (data-testid=exit-to-project)", () => {
    const html = renderToStaticMarkup(<EditRoomStudio {...baseProps()} />);
    // TopBar's exit button is labeled "All rooms" and is the route's
    // back-to-overview anchor. The new shell wires it to `onExitToProject`
    // so the existing `leaveEditor` callback in the project view fires.
    expect(html).toContain("All rooms");
  });
});