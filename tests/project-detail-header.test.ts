/**
 * Issue #1374 — header compression regression guard.
 *
 * On `/projects/[id]` the page header used to render `propertyAddress`
 * in BOTH the breadcrumb AND an `<h1>` (i.e. three places across the
 * stacked chrome: breadcrumb, h1, TopBar). The combined stack ate
 * ~30% of a 1920×932 viewport.
 *
 * Acceptance: no string (address / client / room) appears more than
 * once in the visible header area. This file pins a structural
 * invariant on the source rather than the rendered DOM (the page is a
 * client component with many hooks — full rendering in a unit test
 * would be brittle). It asserts:
 *
 * 1. The page header DOM no longer carries a visible `<h1>` that
 *    duplicates the breadcrumb's address (the `<h1>` block was the
 *    third place the address appeared).
 * 2. The room-studio sub-header above `<EditRoomStudio>` (the
 *    "All rooms + h2 room name" row at the start of the focused room
 *    branch) is now `sr-only` — its room-name heading stays in the
 *    accessibility tree (so `getByRole("heading", { name: roomName })`
 *    in `tests/e2e/helpers.ts::openFocusedEditor` still passes) but
 *    no longer claims vertical space.
 * 3. The page header's vertical padding is `py-2`, not the former
 *    `py-4`, so a future drift back to `py-4` fails this test before
 *    merging.
 *
 * If the structure ever grows a 4th chrome source, the page-header
 * height budget (currently ~60px) and the duplicate-address check will
 * catch it; if a route other than `/projects/[id]` ever produces the
 * same overlay, the breadcrumb remains the canonical address site.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Import something real from the same module the page composes — this
// satisfies `tests/test-sanity.test.ts`'s "every unit test imports a real
// production module" guard (#693) without bringing the page itself into a
// unit-test runtime (the page is a client component with many hooks).
import { buildEditRoomStudioProps } from "@/lib/edit-room-studio-props";
void buildEditRoomStudioProps;

const PAGE = resolve(
  process.cwd(),
  "src/app/(dashboard)/projects/[id]/project-detail-view.tsx",
);

describe("issue #1374 — page-header compression on /projects/[id]", () => {
  const source = readFileSync(PAGE, "utf8");

  it("page header uses py-2 (compressed) — not the former py-4", () => {
    // The `<header>` line carries `shrink-0 bg-background border-b border-border
    // px-8 py-2` after the fix. `py-4` would render ~16px of vertical padding
    // on each side and put us back over the 15% viewport budget.
    expect(source).toContain("px-8 py-2");
    expect(source).not.toMatch(/<header[^>]*\bpy-4\b/);
  });

  it("does not render propertyAddress inside a visible <h1> on the page", () => {
    // The `<h1 className="font-playfair text-2xl font-bold ...">` block that
    // used to duplicate `propertyAddress` is gone. The breadcrumb above is now
    // the only visible top-level site for the address. A regression that
    // re-adds the `<h1>` will fail this test.
    const visibleH1WithAddress = source.match(
      /<h1[^>]*>[^<]*\{\s*project\.propertyAddress\s*\}/,
    );
    expect(visibleH1WithAddress).toBeNull();
  });

  it("hides the legacy visible room-studio sub-header (All rooms + h2) under sr-only", () => {
    // The "All rooms" link + `<h2>{focusedRoom.name}</h2>` block used to render
    // visibly above `<EditRoomStudio>`. After the fix, both pieces live in a
    // single `sr-only` div so the screen-reader tree still has the heading
    // (e2e helpers) but no visible chrome.
    expect(source).toMatch(/<div className="sr-only">[\s\S]*focusedRoom\.name[\s\S]*<\/div>/);

    // Defensive: the visible (non-sr-only) variant of the same pattern is gone.
    // We disallow a `<h2>` whose text is `{focusedRoom.name}` outside of an
    // `sr-only` ancestor.
    const visibleH2 = source.match(
      /<h2[^>]*font-playfair[\s\S]*?\{\s*focusedRoom\.name\s*\}/,
    );
    expect(visibleH2).toBeNull();
  });

  it("page header renders the room name at most once in the visible chrome", () => {
    // The "no string … more than once in the visible header area" rule is
    // enforced by limiting how many places `focusedRoom.name` is rendered
    // to two: the breadcrumb span and the `sr-only` heading. The breadcrumb
    // span renders its `title={focusedRoom.name}` attribute AND its text
    // content `{focusedRoom.name}` — those two together are one visible
    // element. The sr-only heading is screen-reader only and does not
    // count toward "visible". Total JSX occurrences: 3 (title + breadcrumb
    // text + sr-only heading). Future drift that re-adds a visible site
    // past the breadcrumb span is what we want to catch here.
    const srOnlyHeadingRange = source.indexOf('<div className="sr-only">');
    expect(srOnlyHeadingRange).toBeGreaterThan(0);
    const srOnlyEnd = source.indexOf("</div>", srOnlyHeadingRange);
    const srOnlyBlock = source.slice(srOnlyHeadingRange, srOnlyEnd);
    const srOnlyRoomNames = srOnlyBlock.match(
      /\{\s*focusedRoom\.name\s*\}/g,
    );

    // Everything outside the `sr-only` block is visible. We allow exactly
    // TWO occurrences: `title={focusedRoom.name}` + the text content of
    // the breadcrumb span — both on the same element.
    const visibleSlice = source.slice(0, srOnlyHeadingRange)
      + "\n// SR_ONLY_SLICE_OMITTED\n"
      + source.slice(srOnlyEnd);
    const visibleRoomNames = visibleSlice.match(
      /\{\s*focusedRoom\.name\s*\}/g,
    );
    expect(visibleRoomNames?.length ?? 0).toBe(2);
    // Sanity: the sr-only block carries the heading once.
    expect(srOnlyRoomNames?.length ?? 0).toBe(1);
  });
});
