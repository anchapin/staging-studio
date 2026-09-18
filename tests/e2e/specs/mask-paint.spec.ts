import { expect, test } from "@playwright/test";

import {
  E2E_EDITOR_PROJECT_ID,
  E2E_EDITOR_ROOM_ID,
} from "../env";
import {
  interceptInpaint,
  interceptSegment,
  login,
  openFocusedEditor,
  paintMaskZigzag,
  whitePixelGeometry,
  whitePixelShare,
} from "../helpers";
import { SAM_TOOL_ENABLED } from "../../../src/lib/sam-tool";

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

/**
 * HiDPI mask alignment (issue #181).
 *
 * The mask canvas backs its buffer at devicePixelRatio (physical pixels)
 * while painting stays in logical canvas space. At 2x DPR these tests pin
 * the two alignment guarantees: (1) a stroke painted at a known viewport
 * point exports to the matching photo region — the mask lands under the
 * cursor — and (2) Fill Region seeds land on the pixel under the cursor,
 * flooding exactly the region that click is inside.
 */
test.describe("mask painting on high-DPI displays", () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });

  async function openEditorWithDirectives(page: import("@playwright/test").Page): Promise<void> {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    const directives = page.getByLabel("Staging directives (required)");
    await expect(directives).toBeVisible();
    await directives.fill("Add a neutral linen sofa and a warm wood coffee table.");
  }

  function brushCanvas(page: import("@playwright/test").Page) {
    return page
      .getByRole("application")
      .locator('canvas[aria-label^="Room mask painting canvas"]');
  }

  test("backing store is device-pixel scaled and a centered stroke masks the photo center", async ({
    page,
  }) => {
    const inpaint = interceptInpaint(page);
    await openEditorWithDirectives(page);

    const canvas = brushCanvas(page);
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;

    // Crispness: the backing store must be at least the display's physical
    // pixel resolution (CSS size x devicePixelRatio), i.e. never upscaled.
    const geometry = await canvas.evaluate((el) => ({
      backingWidth: (el as HTMLCanvasElement).width,
      backingHeight: (el as HTMLCanvasElement).height,
      cssWidth: el.getBoundingClientRect().width,
      cssHeight: el.getBoundingClientRect().height,
      dpr: window.devicePixelRatio,
    }));
    expect(geometry.dpr).toBe(2);
    expect(geometry.backingWidth).toBeGreaterThanOrEqual(
      Math.round(geometry.cssWidth * geometry.dpr)
    );
    expect(geometry.backingHeight).toBeGreaterThanOrEqual(
      Math.round(geometry.cssHeight * geometry.dpr)
    );

    // Paint a short stroke centered exactly at the canvas midpoint with
    // real trusted mouse input.
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 3, cy, { steps: 2 });
    await page.mouse.up();

    const applyButton = page.getByRole("button", { name: "Apply Inpainting" });
    await expect(applyButton).toBeEnabled();
    await applyButton.click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    // The exported mask (rescaled to the photo's natural pixels) must have
    // its white centroid at the photo center — the painted pixel landed
    // under the cursor — and stay a localized blob (no bleed).
    const mask = await whitePixelGeometry(page, inpaint.maskDataUrl());
    expect(mask.centroid.x).toBeGreaterThan(0.45);
    expect(mask.centroid.x).toBeLessThan(0.55);
    expect(mask.centroid.y).toBeGreaterThan(0.45);
    expect(mask.centroid.y).toBeLessThan(0.55);
    expect(mask.bbox.maxX - mask.bbox.minX).toBeLessThan(0.15);
    expect(mask.bbox.maxY - mask.bbox.minY).toBeLessThan(0.15);
    expect(mask.share).toBeGreaterThan(0.0005);
    expect(mask.share).toBeLessThan(0.15);
  });

  test("Fill Region seed lands under the cursor and floods only the region containing it", async ({
    page,
  }) => {
    const inpaint = interceptInpaint(page);
    await openEditorWithDirectives(page);

    const canvas = brushCanvas(page);
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;

    // Two full-height vertical strokes at 25% and 75% split the canvas
    // into three regions (≈24% / ≈48% / ≈24% of the area). A seed inside
    // the middle band floods ≈48%; a seed mis-mapped onto an outer region
    // (or onto a painted line, which floods nothing) fails the bounds.
    for (const fraction of [0.25, 0.75]) {
      const x = box.x + box.width * fraction;
      await page.mouse.move(x, box.y + 1);
      await page.mouse.down();
      await page.mouse.move(x, box.y + box.height - 1, { steps: 8 });
      await page.mouse.up();
    }

    await page.getByRole("button", { name: "Fill Region" }).click();
    const fillCanvas = page
      .getByRole("application")
      .locator('canvas[aria-label^="Room mask canvas with the Fill Region tool"]');
    await expect(fillCanvas).toBeVisible();
    await fillCanvas.scrollIntoViewIfNeeded();
    const fillBox = (await fillCanvas.boundingBox())!;
    await page.mouse.click(
      fillBox.x + fillBox.width * 0.5,
      fillBox.y + fillBox.height * 0.5
    );

    const applyButton = page.getByRole("button", { name: "Apply Inpainting" });
    await expect(applyButton).toBeEnabled();
    await applyButton.click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    const share = await whitePixelShare(page, inpaint.maskDataUrl());
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.6);
  });
});

/**
 * Click-to-segment (issue #183).
 *
 * The Select Object tool sends one clicked point to /api/segment; the
 * SAM-backed route is intercepted (no paid call) and fulfills with a mask
 * fixture whose white quadrant is observable in the exported /api/inpaint
 * mask. Covers the issue's guardrails: repeat clicks on the same point are
 * deduped, and a failing SAM call shows an error while leaving the canvas
 * (and therefore the pending inpaint mask) untouched.
 */
test.describe("select object segmentation", () => {
  // Issue #189: the Select Object tool is hidden from the editor UI for the
  // demo (brush-only). The specs stay pinned here for the post-demo revival
  // (issue #202); they run again once SAM_TOOL_ENABLED flips back to true.
  test.skip(!SAM_TOOL_ENABLED, "SAM Select Object tool is hidden for the demo (issue #189)");
  test("one click paints the segment mask and feeds the inpaint flow", async ({ page }) => {
    const inpaint = interceptInpaint(page);
    const segment = interceptSegment(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    // Apply Inpainting requires staging directives before it will run.
    const directives = page.getByLabel("Staging directives (required)");
    await expect(directives).toBeVisible();
    await directives.fill("Add a neutral linen sofa and a warm wood coffee table.");

    const selectButton = page.getByRole("button", { name: "Select Object" });
    await selectButton.click();
    await expect(selectButton).toHaveAttribute("aria-pressed", "true");

    const canvas = page
      .getByRole("application")
      .locator('canvas[aria-label^="Room mask canvas with the Select Object tool"]');
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const applyButton = page.getByRole("button", { name: "Apply Inpainting" });
    await expect(applyButton).toBeEnabled({ timeout: 15_000 });

    // The click reached /api/segment as a bounded point in natural pixels.
    const body = segment.submitBody();
    const point = body.point as { x: number; y: number };
    expect(point.x).toBeGreaterThan(0);
    expect(point.y).toBeGreaterThan(0);
    expect(point.x).toBeLessThanOrEqual(body.imageWidth as number);
    expect(point.y).toBeLessThanOrEqual(body.imageHeight as number);

    // A repeat click on the same point is deduped — still exactly one
    // request, so the paid SAM endpoint is not re-invoked.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(() => segment.requestCount(), { timeout: 5_000 })
      .toBe(1);

    // The segment mask merged onto the canvas feeds the real inpaint flow.
    await applyButton.click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    const whiteShare = await whitePixelShare(page, inpaint.maskDataUrl());
    expect(whiteShare).toBeGreaterThan(0.05);
    expect(whiteShare).toBeLessThan(0.9);
  });

  test("a failing segment call shows an error and leaves the mask intact", async ({ page }) => {
    const segment = interceptSegment(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    await page.getByRole("button", { name: "Select Object" }).click();

    const canvas = page
      .getByRole("application")
      .locator('canvas[aria-label^="Room mask canvas with the Select Object tool"]');
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;

    // First click succeeds and paints the fixture mask.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const applyButton = page.getByRole("button", { name: "Apply Inpainting" });
    await expect(applyButton).toBeEnabled({ timeout: 15_000 });

    // Second click fails; the error surfaces and the mask survives.
    segment.respondWithFailure();
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await expect(page.getByText("Simulated SAM failure (e2e).")).toBeVisible({
      timeout: 15_000,
    });
    await expect(applyButton).toBeEnabled();
  });
});
