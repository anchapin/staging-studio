import { expect, test } from "@playwright/test";

import { E2E_CONCEPT_PROJECT_ID, E2E_EDITOR_PROJECT_ID } from "../env";
import {
  interceptFurnishingsDetection,
  interceptInpaint,
  interceptLabelInstances,
  login,
  openEditorTab,
  openFocusedEditor,
  paintMaskZigzag,
} from "../helpers";

/**
 * Focused-editor layout (issue #252 D5, AC-L1/L4/L5/L6).
 *
 * Pins the measurable bars of the tabbed two-pane layout at the product
 * owner's laptop viewport: page-level scrolling dies at 1366×768 (the
 * dashboard shell's #main-content scroller must not overflow either —
 * that is the app's real scroll container), the Entire room tab follows
 * the displayed base image, and tab switching is purely presentational.
 */
test.describe("editor layout", () => {
  test.describe("laptop viewport 1366×768", () => {
    test.use({ viewport: { width: 1366, height: 768 } });

    test("no page scroll, tab switch keeps selections and prompts intact", async ({
      page,
    }) => {
      // The editor-open auto-fire (and its vision labeling) must land on
      // the mocks; the default single-instance detection fixture backs
      // the instance toggle below.
      interceptFurnishingsDetection(page);
      interceptLabelInstances(page);

      await login(page);
      await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

      // AC-L1: zero page-level vertical scroll. document.scrollingElement
      // is the letter of the bar; #main-content is the shell's actual
      // scroll container — both must hold.
      const documentScroll = await page.evaluate(() => {
        const el = document.scrollingElement;
        if (!el) throw new Error("no scrolling element");
        return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      });
      expect(documentScroll.scrollHeight).toBeLessThanOrEqual(
        documentScroll.clientHeight + 2
      );
      const shellScroll = await page.evaluate(() => {
        const main = document.getElementById("main-content");
        if (!main) throw new Error("#main-content not found");
        return { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight };
      });
      expect(shellScroll.scrollHeight).toBeLessThanOrEqual(
        shellScroll.clientHeight + 2
      );

      // AC-L4 (positive half): the base is the original photo, so the
      // Entire room tab is visible alongside Manual paint + Auto detect.
      await expect(page.getByRole("tab", { name: "Entire room" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Manual paint" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Auto detect" })).toBeVisible();

      // ---- Toggle a detected instance (concept-flow's click pattern) --
      await page.getByRole("button", { name: "Select Regions" }).click();
      const canvas = page
        .getByRole("application")
        .locator(
          'canvas[aria-label^="Room mask canvas with the Select Regions tool active"]'
        );
      await expect(canvas).toBeVisible();
      await canvas.scrollIntoViewIfNeeded();
      const box = (await canvas.boundingBox())!;
      const batchPanel = page.locator('section[aria-label="Batch region staging"]');

      // Instance 0 is the full-width band — a canvas-center click lands
      // inside it; the retry wrapper absorbs the decode race.
      await expect(async () => {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(batchPanel.getByText("1 / 5 regions")).toBeVisible();
      }).toPass({ timeout: 15_000 });

      // AC-L5: the pending selection lights the Auto detect tab badge.
      await expect(page.getByRole("tab", { name: "Auto detect" })).toContainText("1");

      // ---- Tab switching is purely presentational ---------------------
      const thematicPrompt = page.locator("#batch-thematic-prompt");
      await thematicPrompt.fill("warm mid-century seating");

      await openEditorTab(page, "Manual paint");
      // The Manual paint tab exposes the single-object run affordance
      // (AC-L7); the selection work is untouched by the switch.
      await expect(
        page.getByRole("button", { name: "Apply Inpainting" })
      ).toBeVisible();

      await openEditorTab(page, "Auto detect");
      await expect(batchPanel.getByText("1 / 5 regions")).toBeVisible();
      await expect(thematicPrompt).toHaveValue("warm mid-century seating");
      // The badge survives the round-trip — nothing was cleared.
      await expect(page.getByRole("tab", { name: "Auto detect" })).toContainText("1");
    });

    test("Entire room tab hides over a staged variant and returns on the original photo (AC-L4)", async ({
      page,
    }) => {
      // The run's request body is asserted by mask-paint.spec; here the
      // interception only keeps the route hermetic. NOTE: this test stages
      // a REAL variant, so it runs against the Concept room — a run here
      // would otherwise leave the Editor room's variant state polluted for
      // mask-paint.spec, which expects the seeded pristine room.
      interceptInpaint(page);
      interceptFurnishingsDetection(page);
      interceptLabelInstances(page);

      await login(page);
      await openFocusedEditor(page, E2E_CONCEPT_PROJECT_ID, "Concept Room");

      // Produce a staged result: paint a mask and run the manual flow.
      await page.getByLabel("Staging directives (required)").fill(
        "Add a neutral linen sofa and a warm wood coffee table."
      );
      await openEditorTab(page, "Manual paint");
      await paintMaskZigzag(page);
      await page.getByRole("button", { name: "Apply Inpainting" }).click();
      await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
        timeout: 20_000,
      });

      // The staged variant is now an available base; editing from it must
      // hide the Entire room tab (no restage-on-top-of-result).
      await page.getByRole("radio", { name: "Variant A (staged)" }).click();
      await expect(page.getByRole("tab", { name: "Entire room" })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Manual paint" })).toBeVisible();

      // Switching the base back brings the tab straight back.
      await page.getByRole("radio", { name: "Original photo" }).click();
      await expect(page.getByRole("tab", { name: "Entire room" })).toBeVisible();
    });
  });

  test.describe("below lg (stacked fallback, AC-L6)", () => {
    test.use({ viewport: { width: 900, height: 800 } });

    test("stacked column keeps the same tabs and never overflows horizontally", async ({
      page,
    }) => {
      interceptFurnishingsDetection(page);
      interceptLabelInstances(page);

      await login(page);
      await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

      await expect(page.getByRole("tab", { name: "Entire room" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Manual paint" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Auto detect" })).toBeVisible();

      const documentScroll = await page.evaluate(() => {
        const el = document.scrollingElement;
        if (!el) throw new Error("no scrolling element");
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
      expect(documentScroll.scrollWidth).toBeLessThanOrEqual(
        documentScroll.clientWidth + 2
      );
    });
  });
});
