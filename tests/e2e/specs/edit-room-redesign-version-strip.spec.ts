import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID } from "../env";
import { login, openFocusedEditor } from "../helpers";

/**
 * Issue #1344 — `<VersionStrip>` lookbook-slot CTA on the new surface.
 *
 * The new `<EditRoomStudio>` mounts the strip with the same
 * `Use Variant A in lookbook` / `Use Variant B in lookbook` CTAs
 * (`data-testid="lookbook-cta"`) that the legacy surface had. The
 * badge above the slot moves between "Original", "A", and "B" on
 * click; the strip's `data-lookbook-slot` attribute reflects the
 * local optimistic state.
 *
 * The strip uses `data-lookbook-slot="original|A|B"` (the shell's
 * `SlotId` type). On click, the local state advances through the
 * slots; the server action (`setLookbookVariant`) is stubbed out
 * here (no real DB write) — the test asserts the UI behavior, not
 * persistence. Persistence is pinned by the action-level unit
 * test (`tests/lookbook-variant.test.ts`).
 */

const NEW_STUDIO_TESTID = "edit-room-studio";

// Issue #1344 — see comment on edit-room-redesign-mask-paint.spec.ts.
// `NEXT_PUBLIC_*` is build-time inlined so the harness carries one
// flag value per build; the harness defaults to `"0"` (legacy) so the
// existing legacy specs pass, and this `describe` is skipped until a
// follow-up slice flips the flag and updates legacy selectors.
test.describe.skip("Edit Room redesign — version strip CTA (issue #1344, flag=ON)", () => {
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

  test("Clicking the CTA flips the lookbook-slot attribute", async ({
    page,
  }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // The shell seeds `data-lookbook-slot="A"` from the room's
    // `selectedVariantIndex` (the seed room has it set to 0 → A).
    const studio = page.getByTestId(NEW_STUDIO_TESTID);
    await expect(studio).toHaveAttribute("data-lookbook-slot", "A");

    // Click the CTA — the local state moves to the next slot (B).
    await studio.getByTestId("lookbook-cta").click();
    await expect(studio).toHaveAttribute("data-lookbook-slot", "B");

    // Click again — moves back to original (the strip cycles
    // A → B → original → A). The CTA is rendered as `Use … in lookbook`
    // with the next-slot label, so its text also reflects the change.
    await studio.getByTestId("lookbook-cta").click();
    await expect(studio).toHaveAttribute("data-lookbook-slot", "original");
  });
});