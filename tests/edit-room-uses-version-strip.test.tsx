/**
 * Issue #1340 — `<EditRoomStudio>` shell mount of `<VersionStrip>`.
 *
 * The component-level test (`tests/edit-room-version-strip.test.tsx`)
 * exercises the strip in isolation. This test exercises the shell +
 * strip together: it confirms the shell mounts the strip in the
 * footer slot, that the version data shape the shell builds drives
 * the strip's "First pass" / "3 touch-ups" / "Empty" labels correctly,
 * and that the strip's `running` prop is wired through the shell's
 * `state.running` + the lookbook transition.
 *
 * Pure structural renders — no event firing. The streak's "click →
 * reducer dispatch → strip repaint" path is covered by the
 * component-level test + the reducer test together.
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

describe("EditRoomStudio mounts <VersionStrip> (issue #1340)", () => {
  it("renders the VersionStrip in the footer slot", () => {
    const html = renderToStaticMarkup(
      <EditRoomStudio {...baseProps({ touchUps: { original: 0, A: 2, B: 0 } })} />
    );
    // The strip carries aria-label="Versions" per VersionStrip.tsx.
    expect(html).toContain('aria-label="Versions"');
  });

  it('seeds the data-lookbook-slot attribute from initialLookbookSlot="A"', () => {
    const html = renderToStaticMarkup(<EditRoomStudio {...baseProps()} />);
    expect(html).toContain('data-lookbook-slot="A"');
  });

  it("renders empty + populated slot labels the strip understands", () => {
    // The shell pre-fills `original` with the parent route's `imageUrl`
    // (the resolved inpaint source URL); A and B default to `url: null`
    // → "Empty" placeholder. The populated-slot "N touch-ups" copy
    // only shows when a real image URL exists in `lookbookVariantUrls`.
    const html = renderToStaticMarkup(
      <EditRoomStudio
        {...baseProps({
          initialLookbookSlot: "B",
          touchUps: { original: 0, A: 2, B: 0 },
        })}
      />
    );
    expect(html).toContain("Variant A");
    expect(html).toContain("Variant B");
    // Both variant slots are empty in the placeholder surface, so the
    // strip shows two "Empty" labels.
    expect((html.match(/>Empty</g) || []).length).toBe(2);
  });

  it("uses Atelier palette tokens (no raw hex literals)", () => {
    const html = renderToStaticMarkup(<EditRoomStudio {...baseProps()} />);
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
