import { expect, test } from "@playwright/test";

import {
  E2E_EDITOR_PROJECT_ID,
  E2E_EDITOR_ROOM_ID,
} from "../env";
import {
  interceptInpaint,
  login,
  openFocusedEditor,
  paintMaskZigzag,
  whitePixelShare,
} from "../helpers";

const EDITOR_PROJECT = `/projects/${E2E_EDITOR_PROJECT_ID}`;
const MIN_WHITE_SHARE = 0.01; // 1% of canvas pixels

/**
 * Mask painting (issue #165 acceptance criterion 1).
 *
 * The PoC driver could make the component's handlers fire (dispatched
 * MouseEvents) but the strokes never landed — intercepted /api/inpaint
 * bodies were 100% black masks. Here Playwright drives Chrome's real
 * input pipeline (trusted, hit-tested mouse events) through the app's
 * real canvas handlers, then samples the ACTUAL POST /api/inpaint body
 * the browser built: the mask data URL must decode with white coverage
 * above a threshold.
 */
test.describe("mask painting", () => {
  test("brush strokes produce a non-black mask in the real /api/inpaint body", async ({
    page,
  }) => {
    const inpaint = interceptInpaint(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    // The staged-directives textarea only renders once the room has a
    // before photo (seeded by global setup).
    const directives = page.getByLabel("Staging directives (required)");
    await expect(directives).toBeVisible();
    await directives.fill("Add a neutral linen sofa and a warm wood coffee table.");

    // "Apply Inpainting" is disabled until a mask exists — the UI state
    // transition this flow hinges on.
    const applyButton = page.getByRole("button", { name: "Apply Inpainting" });
    await expect(applyButton).toBeDisabled();

    await paintMaskZigzag(page);

    await expect(applyButton).toBeEnabled();

    await applyButton.click();

    // The status poll resolves via the interception; success toast is the
    // hook's completion signal.
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    // Completion persists the staged image through the app's REAL room
    // PATCH route against the local database — the staged result section
    // (issue #168) renders once that write lands.
    await expect(page.getByRole("heading", { name: "Staged result" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText("Staged image saved as Variant A.")
    ).toBeVisible();

    const body = inpaint.submitBody();
    expect(body.imageUrl).toContain(`/rooms/${E2E_EDITOR_ROOM_ID}/before-image.png`);
    expect(body.promptDirectives).toBe(
      "Add a neutral linen sofa and a warm wood coffee table."
    );
    expect(body.variantSlot).toBe(0);

    const whiteShare = await whitePixelShare(page, inpaint.maskDataUrl());
    expect(
      whiteShare,
      `mask exported from the real request body must have >${MIN_WHITE_SHARE * 100}% white coverage`
    ).toBeGreaterThan(MIN_WHITE_SHARE);
    expect(whiteShare, "mask must not be a full-canvas smear").toBeLessThan(0.9);
  });

  test("Fill Region floods a region through a single trusted click", async ({ page }) => {
    const inpaint = interceptInpaint(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    const directives = page.getByLabel("Staging directives (required)");
    await expect(directives).toBeVisible();
    await directives.fill("Anchor the seating area with warm, neutral textures.");

    await page.getByRole("button", { name: "Fill Region" }).click();
    await expect(page.getByRole("button", { name: "Fill Region" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await expect(page.getByRole("button", { name: "Apply Inpainting" })).toBeDisabled();

    // One click anywhere on the untouched canvas floods the connected
    // unpainted region — deterministic, near-total white coverage.
    const canvas = page
      .getByRole("application")
      .locator('canvas[aria-label^="Room mask canvas with the Fill Region tool"]');
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.getByRole("button", { name: "Apply Inpainting" })).toBeEnabled();

    await page.getByRole("button", { name: "Apply Inpainting" }).click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    const whiteShare = await whitePixelShare(page, inpaint.maskDataUrl());
    expect(whiteShare).toBeGreaterThan(0.9);
  });

  test("Clear Mask resets the editor back to the disabled state", async ({ page }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    const applyButton = page.getByRole("button", { name: "Apply Inpainting" });
    await expect(applyButton).toBeDisabled();

    await paintMaskZigzag(page);
    await expect(applyButton).toBeEnabled();

    await page.getByRole("button", { name: "Clear Mask" }).click();
    await expect(applyButton).toBeDisabled();

    // The empty-state hint comes back only when nothing is painted.
    await expect(page.getByText("Drag to paint over the object you want changed")).toBeVisible();
  });
});
