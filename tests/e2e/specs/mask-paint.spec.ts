import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID, E2E_EDITOR_ROOM_ID } from "../env";
import {
  interceptFurnishingsDetection,
  interceptInpaint,
  interceptLabelInstances,
  login,
  openFocusedEditor,
  paintMaskZigzag,
  whitePixelShare,
} from "../helpers";

const MIN_WHITE_SHARE = 0.01; // 1% of canvas pixels

// Issue #252: the editor-open auto-fire bills a detection on open, and a
// billed detection fires the OpenAI-backed vision-labeling call. With the
// #1344 harness default flipped to `"1"`, the new `<EditRoomStudio>`
// surface mounts without billing any detection (the studio's `detections`
// are a stub until the real `/api/segment/furnishings` lands). The mocks
// stay registered here defensively in case a follow-up slice wires the
// detection call into the new surface — the suite keeps its hermeticity
// contract either way.
test.beforeEach(({ page }) => {
  interceptLabelInstances(page);
});

/**
 * Mask painting + real `/api/inpaint` submit (issue #165 acceptance
 * criterion 1, retargeted to the new `<EditRoomStudio>` surface).
 *
 * With `NEXT_PUBLIC_EDIT_ROOM_REDESIGN=1` (the harness default since
 * #1344), the focused editor mounts the new shell + the new
 * `<MaskLayer>` (issue #1339). The Run button (`data-testid="run-button"`)
 * is disabled until BOTH directions AND a mask exist (issue #1342 +
 * #1344's real `/api/inpaint` wire); a click submits the request the
 * same way the legacy `<InpaintEditor>` did. The body the browser puts
 * on the wire must still decode with white coverage above a threshold
 * — that's the contract this spec pins on the new surface.
 */
test.describe("mask painting", () => {
  test("brush strokes produce a non-black mask in the real /api/inpaint body", async ({
    page,
  }) => {
    const inpaint = interceptInpaint(page);
    interceptFurnishingsDetection(page);
    interceptLabelInstances(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    // The new surface's Directions textarea (label = "Directions" — see
    // StagePanel.tsx lines 263–268). The legacy "Staging directives
    // (required)" label is unreachable when the flag is on.
    const directives = page.getByRole("textbox", { name: "Directions" });
    await expect(directives).toBeVisible();
    await directives.fill("Add a neutral linen sofa and a warm wood coffee table.");

    // Issue #1344 — switch to Paint area scope so the canvas accepts
    // brush strokes. The default scope is "Whole room" (no canvas
    // painting); the radio group lives under the "What should change?"
    // heading in the StagePanel.
    await page.getByRole("radio", { name: "Paint area" }).click();

    // The new surface's Run button (issue #1342): disabled until
    // directions + mask exist. The label resolver
    // (`resolveRunLabel`) reads `scope === "paint"` →
    // "Restage painted area" regardless of the blocked reason.
    const run = page.getByTestId("run-button");
    await expect(run).toBeDisabled();
    await expect(run).toContainText("Restage painted area");

    await paintMaskZigzag(page);
    await expect(run).toBeEnabled();

    await run.click();

    // The status poll resolves via the interception; success toast is
    // the hook's completion signal. The toast text comes from
    // `use-inpaint-runs.ts` (issue #1344's wire).
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    const body = inpaint.submitBody();
    expect(body.imageUrl).toContain(`/rooms/${E2E_EDITOR_ROOM_ID}/before-image.png`);
    expect(body.promptDirectives).toBe(
      "Add a neutral linen sofa and a warm wood coffee table."
    );

    const whiteShare = await whitePixelShare(page, inpaint.maskDataUrl());
    expect(
      whiteShare,
      `mask exported from the real request body must have >${MIN_WHITE_SHARE * 100}% white coverage`
    ).toBeGreaterThan(MIN_WHITE_SHARE);
    expect(whiteShare, "mask must not be a full-canvas smear").toBeLessThan(0.9);
  });

  test("Clear resets the editor back to the disabled state", async ({ page }) => {
    interceptFurnishingsDetection(page);
    interceptLabelInstances(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    await page.getByRole("radio", { name: "Paint area" }).click();

    const run = page.getByTestId("run-button");
    await expect(run).toBeDisabled();

    await paintMaskZigzag(page);
    await expect(run).toBeEnabled();

    // The CanvasStage toolbar's Clear button — `data-testid` absent,
    // scoped by the active role in the toolbar group.
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(run).toBeDisabled();
  });
});

/**
 * HiDPI mask alignment (issue #181), retargeted to the new surface.
 *
 * The new `<MaskLayer>` (issue #1339) backs its buffer at
 * devicePixelRatio (physical pixels) while painting stays in logical
 * canvas space — same discipline as the legacy layer. At 2x DPR this
 * spec pins the two alignment guarantees on the new surface:
 * (1) a stroke painted at a known viewport point exports to the
 * matching photo region — the mask lands under the cursor — and
 * (2) the canvas backing-store is at least the display's physical
 * pixel resolution (CSS size x devicePixelRatio).
 *
 * The legacy parts (Fill Region's seed under the cursor, redo + zoom)
 * have no equivalent in the new surface yet — Fill Region is a
 * legacy-only mask tool and the new `<MaskLayer>` doesn't expose
 * undo/redo/zoom (issue #1344 wired the real `/api/inpaint`
 * submit but left those features as follow-ups). The corresponding
 * cases lived in this slice's pre-#1344 file and were dropped in
 * the same PR that flipped the harness default.
 */
test.describe("mask painting on high-DPI displays", () => {
  test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });

  async function openEditorWithDirectives(page: import("@playwright/test").Page): Promise<void> {
    interceptFurnishingsDetection(page);
    interceptLabelInstances(page);
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");
    const directives = page.getByRole("textbox", { name: "Directions" });
    await expect(directives).toBeVisible();
    await directives.fill("Add a neutral linen sofa and a warm wood coffee table.");
    await page.getByRole("radio", { name: "Paint area" }).click();
  }

  function brushCanvas(page: import("@playwright/test").Page) {
    return page.locator('[data-testid="edit-room-canvas"] canvas').first();
  }

  test("backing store is device-pixel scaled and a centered stroke lands the photo center", async ({
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

    const run = page.getByTestId("run-button");
    await expect(run).toBeEnabled();
    await run.click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    // The exported mask (rescaled to the photo's natural pixels) must
    // have white pixels at the photo center — the painted pixel landed
    // under the cursor — and stay a localized blob (no bleed).
    const share = await whitePixelShare(page, inpaint.maskDataUrl());
    expect(share).toBeGreaterThan(0.0005);
    expect(share).toBeLessThan(0.15);
  });
});

/**
 * "Restage furnishings" preset (issue #223) — DROPPED.
 *
 * The preset's regeneration mask is the union of detected per-object
 * furnishings masks and the preset button itself lives in the
 * legacy `<InpaintEditor>`'s "Entire room" tab. The new
 * `<EditRoomStudio>`'s "Whole room" scope has no equivalent preset
 * yet (it's the follow-up slice that pairs Fill Region / batch
 * dispatch / undo / redo / zoom). Re-light when the preset lands on
 * the new surface.
 */