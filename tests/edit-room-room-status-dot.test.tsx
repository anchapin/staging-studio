import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RoomStatusDot } from "@/components/edit-room/room-status-dot";

// Issue #1338: render-to-string test for the extracted StatusDot
// (uses react-dom/server, no @testing-library/react dep needed).
// Pinned by the renderToStaticMarkup assertions below.
describe("RoomStatusDot", () => {
  it("renders the 'Staged' label + a filled dot for the staged state", () => {
    const html = renderToStaticMarkup(<RoomStatusDot status="staged" />);
    // Filled dot: the design's "staged" dot uses the Atelier tertiary
    // (muted sage) — we assert the class is present rather than the
    // literal hex so the test survives a palette rename.
    expect(html).toContain("Staged");
    expect(html).toContain("bg-tertiary");
  });

  it("renders the 'In progress' label + a bronze dot for in-progress", () => {
    const html = renderToStaticMarkup(<RoomStatusDot status="in-progress" />);
    expect(html).toContain("In progress");
    expect(html).toContain("bg-secondary");
  });

  it("renders the 'Not started' label + a hollow dot for empty", () => {
    const html = renderToStaticMarkup(<RoomStatusDot status="empty" />);
    expect(html).toContain("Not started");
    // Hollow: outlined square (no fill class — the design uses a
    // border-only ring with a transparent fill).
    expect(html).toContain("border-outline");
  });
});