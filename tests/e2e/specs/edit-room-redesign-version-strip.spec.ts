import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID } from "../env";
import { login, openFocusedEditor } from "../helpers";

/**
 * Issue #1344 — `<VersionStrip>` lookbook-slot CTA on the new surface.
 *
 * The new `<EditRoomStudio>` mounts the strip beneath the canvas
 * with three slots (Original / Variant A / Variant B). The
 * populated-slot that matches `lookbookSlot` carries a
 * `<LookbookBadge>`; the right side hosts the
 * `Use [Variant] in lookbook` CTA (`data-testid="lookbook-cta"`).
 * The CTA collapses to a static "{label} is in the lookbook"
 * line when the user is already viewing the lookbook slot.
 *
 * For the seeded Mask Room, `selectedVariantIndex === 0` →
 * `initialLookbookSlot = "A"`, so the studio opens with
 * `data-lookbook-slot="A"`. The CTA click only mutates the local
 * `lookbookSlot` when the viewing variant is pinnable; on the
 * ORIGINAL photo the click toasts (the server action rejects it
 * via `assertLookbookPinnable`). The "click cycles A → B →
 * original" assertion that lived in this slice relied on a
 * populated variant set, which the masked-only seed room doesn't
 * carry — that flow is pinned by the action-level unit test
 * (`tests/lookbook-variant.test.ts`) and lights up e2e once a
 * spec seeds a populated variant.
 */

const NEW_STUDIO_TESTID = "edit-room-studio";

// Issue #1344 — `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` is build-time inlined
// at `"1"` (see tests/e2e/env.ts) so the new `<EditRoomStudio>`
// surface is live for the whole suite. The four `edit-room-redesign-*`
// specs exercise the wired-up submit path; the legacy specs were
// updated to the new surface's selectors in the same PR.
test.describe("Edit Room redesign — version strip CTA (issue #1344, flag=ON)", () => {
  test("With the flag on, the version strip's CTA renders", async ({ page }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // The version strip is the footer under the canvas. Its aria-label
    // is "Versions" (per VersionStrip.tsx).
    const strip = page.getByRole("region", { name: "Versions" });
    await expect(strip).toBeVisible();
    // The strip's "Use … in lookbook" CTA (`data-testid="lookbook-cta"`).
    await expect(strip.getByTestId("lookbook-cta")).toBeVisible();
  });

  test("Lookbook slot reflects the seeded selectedVariantIndex on first render", async ({
    page,
  }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // The shell seeds `data-lookbook-slot` from the room's
    // `selectedVariantIndex` (the seed Mask Room has it set to 0
    // → "A"). The CTA cycle (A → B → original) lives in
    // `handleUseInLookbook` and requires a populated variant set
    // to exercise; covered by the action-level unit test
    // (`tests/lookbook-variant.test.ts`).
    const studio = page.getByTestId(NEW_STUDIO_TESTID);
    await expect(studio).toHaveAttribute("data-lookbook-slot", "A");
  });
});