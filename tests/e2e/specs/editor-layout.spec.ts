import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID } from "../env";
import {
  interceptFurnishingsDetection,
  interceptLabelInstances,
  login,
  openFocusedEditor,
} from "../helpers";

/**
 * Focused-editor layout on the new `<EditRoomStudio>` surface
 * (issue #1344, retargeted from the legacy `<InpaintEditor>`).
 *
 * The legacy spec pinned:
 *  - the three legacy tabs ("Entire room" / "Manual paint" /
 *    "Auto detect") — gone, replaced by the new StagePanel's scope
 *    radios ("Whole room" / "Objects" / "Paint area");
 *  - the Select Regions tool + canvas-click batch dispatch — gone,
 *    no canvas-click selection in the new surface yet (follow-up slice);
 *  - the "Variant A (staged)" / "Original photo" picker — gone,
 *    replaced by the new `<VersionStrip>`'s slot thumbnails;
 *  - the "Entire room tab hides over a staged variant" AC — gone,
 *    the new surface's "Switch to original photo" affordance handles
 *    this in a different DOM neighborhood (StagePanel.tsx lines
 *    202–213) and the "Entire room" radio is gated by the same
 *    blocked reason.
 *
 * The smoke test below pins the new surface's structural contract:
 * the studio renders at the legacy laptop viewport and at the stacked
 * fallback, and the new shell carries its data-testid hook. Re-light
 * the legacy interactions when their equivalents land on the new
 * surface.
 */
test.describe("editor layout", () => {
  test.describe("laptop viewport 1366×768", () => {
    test.use({ viewport: { width: 1366, height: 768 } });

    test("no page scroll, new EditRoomStudio mounts at the laptop viewport", async ({
      page,
    }) => {
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

      // The new surface's root container carries `data-testid="edit-room-studio"`.
      await expect(page.getByTestId("edit-room-studio")).toBeVisible();

      // The scope segmented control's three radios (issue #1341).
      await expect(page.getByRole("radio", { name: "Whole room" })).toBeVisible();
      await expect(page.getByRole("radio", { name: "Objects" })).toBeVisible();
      await expect(page.getByRole("radio", { name: "Paint area" })).toBeVisible();

      // The primary Run button + Directions textarea (issue #1342 +
      // #1344): the two staging-affordance anchors on the new surface.
      await expect(page.getByTestId("run-button")).toBeVisible();
      await expect(page.getByLabel("Directions")).toBeVisible();
    });
  });

  test.describe("below lg (stacked fallback)", () => {
    test.use({ viewport: { width: 900, height: 800 } });

    test("stacked column keeps the same controls and never overflows horizontally", async ({
      page,
    }) => {
      interceptFurnishingsDetection(page);
      interceptLabelInstances(page);

      await login(page);
      await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

      await expect(page.getByTestId("edit-room-studio")).toBeVisible();
      await expect(page.getByRole("radio", { name: "Whole room" })).toBeVisible();
      await expect(page.getByRole("radio", { name: "Objects" })).toBeVisible();
      await expect(page.getByRole("radio", { name: "Paint area" })).toBeVisible();

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