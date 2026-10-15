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

// Issue #1344 — see comment on edit-room-redesign-mask-paint.spec.ts.
// `NEXT_PUBLIC_*` is build-time inlined so the harness carries one
// flag value per build; the harness defaults to `"0"` (legacy) so the
// existing legacy specs pass, and this `describe` is skipped until a
// follow-up slice flips the flag and updates legacy selectors.
test.describe.skip("Edit Room redesign — Run button label (issue #1344, flag=ON)", () => {
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

  test("Objects → 'Restage 1 object' when an object is selected", async ({
    page,
  }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // Switch to Objects scope. The Objects scope surfaces the
    // DetectedObjectList (if detections exist) and the ConceptChips
    // row. For this spec we exercise the chip-row path: clicking the
    // first chip selects one object. The chip's accessible name comes
    // from the concept (issue #1341 stub renders the typed concept).
    await page.getByRole("radio", { name: "Objects" }).click();
    // Type a concept to make the chip appear (the studio stub
    // dispatches SET_CONCEPT on submit so the chip row reflects the
    // typed value; the new surface wires the real /api/segment call
    // in a follow-up).
    await page.getByLabel("Concept", { exact: false }).fill("Sofa");
    // Submit the concept so the chip row mounts.
    await page.keyboard.press("Enter");
    // Click the first chip in the chip row (text matches the typed
    // concept verbatim).
    await page.getByRole("button", { name: "Sofa" }).first().click();

    // Now the resolver sees scope=objects + 1 selected → "Restage 1 object".
    await expect(page.getByTestId("run-button")).toContainText(
      "Restage 1 object"
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