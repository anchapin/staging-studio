import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID } from "../env";
import { login, openFocusedEditor } from "../helpers";

/**
 * Issue #1344 — Run-button label flips with scope + selection.
 *
 * `resolveRunLabel` (src/lib/edit-room-run-label.ts) is the pure
 * resolver that pins the Run button's text to the scope/selection:
 *
 * - scope=whole-room, no mask         → "Stage whole room"
 * - scope=objects, 1 selected         → "Restage 1 object"
 * - scope=paint,    hasMask=true      → "Restage painted area"
 *
 * The new `<Inspector>` shell reads the resolver and forwards the
 * label to `<RunButton>` which renders the literal text inside a
 * real `<button data-testid="run-button">`. Pinning the three scope
 * branches on the new surface is the acceptance criterion for
 * "label is dynamic".
 *
 * (We deliberately do NOT click the Run button — the full
 * `/api/inpaint` wire is the next slice behind this flag.)
 */

const NEW_STUDIO_TESTID = "edit-room-studio";

// Issue #1344 — `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` is build-time inlined
// at `"1"` (see tests/e2e/env.ts) so the new `<EditRoomStudio>`
// surface is live for the whole suite. The four `edit-room-redesign-*`
// specs exercise the wired-up submit path; the legacy specs were
// updated to the new surface's selectors in the same PR.
test.describe("Edit Room redesign — Run button label (issue #1344, flag=ON)", () => {
  test("Whole room → 'Stage whole room'", async ({ page }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // Default scope is whole-room; the textarea is empty so the Run
    // button is blocked (no directions → blocked). The label is still
    // pinned to "Stage whole room" — the resolver returns this label
    // regardless of the blocked reason.
    const run = page.getByTestId("run-button");
    await expect(run).toContainText("Stage whole room");
  });

  test("Objects → 'Restage 0 objects' on the original photo (selections require a populated variant)", async ({
    page,
  }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // The resolver (`src/lib/edit-room-run-label.ts`) reads
    // `(scope, selectedCount)` and ignores whether the count is gated
    // by a "blocked" reason — so the label flips the moment the
    // user picks Objects scope, even before any variant is selected.
    // Picking "Restage 1 object" specifically requires a populated
    // variant (the `<DetectedObjectList>` only mounts when
    // `viewing !== "original"`, see StagePanel.tsx lines 215–236),
    // which in turn requires a prior inpaint run — out of scope for
    // this resolver-only assertion. We pin the unselected label here
    // and re-light the "1 object" assertion when the run path lands
    // a separate spec.
    await page.getByRole("radio", { name: "Objects" }).click();
    await expect(page.getByTestId("run-button")).toContainText(
      "Restage 0 objects"
    );
  });

  test("Paint area → 'Restage painted area' after a brush stroke", async ({
    page,
  }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // Switch to Paint area scope. The StagePanel surfaces brush
    // controls (slider + clear button) — clicking any pixel on the
    // photo paints a mask; we trigger that with a synthetic mouse
    // event on the canvas via the mask canvas locator.
    await page.getByRole("radio", { name: "Paint area" }).click();

    const canvas = page
      .locator('[data-testid="edit-room-canvas"] canvas')
      .first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("paint canvas not laid out");
    // One brush stroke is enough to flip hasMask.
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, {
      steps: 8,
    });
    await page.mouse.up();

    await expect(page.getByTestId("run-button")).toContainText(
      "Restage painted area"
    );
  });
});