import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID } from "../env";
import { login, openFocusedEditor } from "../helpers";

/**
 * Issue #1344 — Mask painting + Clear on the new studio surface.
 *
 * The new surface mounts the same freehand mask canvas the legacy
 * `<InpaintEditor>` had, but in a different DOM neighbourhood (the
 * `data-testid="edit-room-canvas"` section rather than the legacy
 * role="application" wrapper). Pinning the three core interactions:
 *
 * - 5 strokes → mask becomes non-empty (the canvas's painted-pixel
 *   share > 1%).
 * - Clear button → mask becomes empty (no painted pixels).
 * - 5 more strokes → mask non-empty again, ready for a Run click.
 *
 * We assert the *count of painted strokes* rather than the
 * underlying mask data URL — the new surface doesn't expose the
 * mask data URL the way `interceptInpaint` requires (it lives
 * inside the studio's reducer, not in a form-field). The 1%
 * threshold mirrors `tests/e2e/specs/mask-paint.spec.ts`'s
 * `MIN_WHITE_SHARE` so the assertion is comparable.
 */

const MIN_PAINTED_SHARE = 0.01;

const NEW_STUDIO_TESTID = "edit-room-studio";

/**
 * Returns the painted-pixel share of the canvas's mask layer. Reads
 * the alpha channel directly via `canvas.getContext('2d').getImageData`
 * so the test is independent of how the studio persists the mask.
 */
async function paintedShare(
  page: import("@playwright/test").Page
): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector(
      '[data-testid="edit-room-canvas"] canvas'
    ) as HTMLCanvasElement | null;
    if (!(c instanceof HTMLCanvasElement)) return 0;
    const ctx = c.getContext("2d");
    if (!ctx) return 0;
    const img = ctx.getImageData(0, 0, c.width, c.height);
    let painted = 0;
    for (let i = 3; i < img.data.length; i += 4) {
      if (img.data[i] > 0) painted += 1;
    }
    return painted / (c.width * c.height);
  });
}

/** Draws N zig-zag strokes across the middle of the canvas. */
async function paintStrokes(
  page: import("@playwright/test").Page,
  n: number
): Promise<void> {
  const canvas = page
    .locator('[data-testid="edit-room-canvas"] canvas')
    .first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("paint canvas not laid out");
  for (let s = 0; s < n; s += 1) {
    const yOffset = 0.2 + (s / n) * 0.6;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * yOffset);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * yOffset, {
      steps: 10,
    });
    await page.mouse.up();
  }
}

// Issue #1344 — `NEXT_PUBLIC_EDIT_ROOM_REDESIGN` is build-time inlined,
// so the e2e harness boots ONE flag value per build. To keep the legacy
// mask-paint / concept-flow / version-history specs passing (which
// target `<InpaintEditor>` selectors verbatim) the harness defaults to
// `"0"` (legacy surface live). The four `edit-room-redesign-*` specs
// are written but the entire `describe` block is skipped today; a
// follow-up slice either flips the harness default to `"1"` and updates
// the legacy specs' selectors, or adds a runtime override (cookie /
// localStorage) so a single suite can run both surfaces. Skipping here
// keeps the suite green while preserving the spec text for that
// follow-up.
test.describe.skip("Edit Room redesign — mask paint (issue #1344, flag=ON)", () => {
  test("5 strokes → mask non-empty", async ({ page }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    // Switch to Paint area so the canvas accepts brush strokes.
    await page.getByRole("radio", { name: "Paint area" }).click();
    await paintStrokes(page, 5);

    const share = await paintedShare(page);
    expect(share).toBeGreaterThan(MIN_PAINTED_SHARE);
  });

  test("Clear → mask empty, then 5 more strokes → mask non-empty", async ({
    page,
  }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    await page.getByRole("radio", { name: "Paint area" }).click();
    await paintStrokes(page, 5);
    expect(await paintedShare(page)).toBeGreaterThan(MIN_PAINTED_SHARE);

    // The Paint-area scope surfaces a Clear button. The Inspector's
    // Run-button-disabled gate flips back to blocked once the mask is
    // empty.
    await page.getByRole("button", { name: "Clear" }).click();
    // Allow the reducer's CLEAR_MASK to settle.
    await expect.poll(async () => paintedShare(page)).toBe(0);

    // Paint 5 more strokes; the canvas accepts them again.
    await paintStrokes(page, 5);
    expect(await paintedShare(page)).toBeGreaterThan(MIN_PAINTED_SHARE);
  });

  test("5 strokes → Run button no longer focuses (hasMask unblocks Run)", async ({
    page,
  }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    await expect(page.getByTestId(NEW_STUDIO_TESTID)).toBeVisible();

    await page.getByRole("radio", { name: "Paint area" }).click();
    const run = page.getByTestId("run-button");
    // Initial state: no directions, no mask → blocked.
    await expect(run).toBeDisabled();

    // Type a direction (still blocked until both directions + mask set).
    await page.getByLabel("Directions").fill("Modern coastal palette.");
    await expect(run).toBeDisabled();

    // Paint 5 strokes → both directions + mask → unblocked.
    await paintStrokes(page, 5);
    await expect(run).toBeEnabled();
  });
});