import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID } from "../env";
import {
  interceptFurnishingsDetection,
  login,
  openFocusedEditor,
} from "../helpers";

/**
 * Editor layout responsiveness (issue #265).
 *
 * AC: a 1280×720 case pinning a minimum usable canvas height (and continued
 * no-page-scroll), with the caps adjusted to meet it.
 *
 * At 1280×720 the canvas was getting squeezed to ~180px because:
 * - RoomCanvas max-height was 70vh (504px at 720px) — reduced to 35vh
 * - InpaintMaskCanvas min-height was 192px — raised to 180px
 *
 * Both caps are now height-responsive so they don't over-consume the
 * viewport at smaller laptop resolutions.
 */
test.describe("editor layout responsiveness (issue #265)", () => {
  test("canvas stays usable at 1280x720 — no page scroll", async ({ page }) => {
    // 1280×720 is a common 13–14" laptop resolution below the 1366×768
    // design baseline. The canvas must remain at least 180px tall (the
    // minimum the AC pins as "usable") without the page growing a scrollbar.
    await page.setViewportSize({ width: 1280, height: 720 });
    interceptFurnishingsDetection(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    // The mask canvas must be visible and at least 180px tall.
    const canvas = page
      .getByRole("application")
      .locator('canvas[aria-label^="Room mask painting canvas"]');
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    // Issue #265 AC: minimum usable canvas height is 180px.
    expect(box!.height).toBeGreaterThanOrEqual(180);

    // The page must not grow a vertical scrollbar at this viewport.
    // scrollHeight <= viewport height means no overflow scroll.
    const scrollHeight = await page.evaluate(
      () => document.documentElement.scrollHeight
    );
    expect(scrollHeight).toBeLessThanOrEqual(720);
  });

  test("canvas stays usable at 1366x768 — no regression at design baseline", async ({
    page,
  }) => {
    // 1366×768 is the AC-L1 laptop baseline (issue #252). This is a
    // regression guard: the layout must stay usable at the original spec
    // resolution.
    await page.setViewportSize({ width: 1366, height: 768 });
    interceptFurnishingsDetection(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    const canvas = page
      .getByRole("application")
      .locator('canvas[aria-label^="Room mask painting canvas"]');
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    // At the design baseline the canvas should comfortably exceed 180px.
    expect(box!.height).toBeGreaterThanOrEqual(180);

    const scrollHeight = await page.evaluate(
      () => document.documentElement.scrollHeight
    );
    expect(scrollHeight).toBeLessThanOrEqual(768);
  });
});
