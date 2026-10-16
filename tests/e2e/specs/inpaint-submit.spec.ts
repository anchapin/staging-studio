import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID } from "../env";
import {
  interceptFurnishingsDetection,
  interceptInpaint,
  interceptLabelInstances,
  login,
  openFocusedEditor,
  paintMaskZigzag,
  waitForDirectivesSaved,
} from "../helpers";

/**
 * Issue #834: E2E suite missing inpaint submit + status-polling flow,
 * retargeted to the new `<EditRoomStudio>` surface (issue #1344).
 *
 * The harness default flipped to `NEXT_PUBLIC_EDIT_ROOM_REDESIGN=1`,
 * so the focused editor now mounts the new shell + the new
 * `<MaskLayer>`. The Run button (`data-testid="run-button"`) is the
 * single submit affordance; clicking it triggers the same
 * `/api/inpaint` POST + status polling the legacy `<InpaintEditor>`
 * did. The hermeticity contract holds: every third-party call lands
 * on a browser-layer mock.
 *
 * The legacy "Staging directives (required)" label + "Generate" button
 * are unreachable when the flag is on (they live in the legacy mount
 * the flag-off branch gates). Spec text below uses the new surface's
 * selectors only.
 */
test.describe("inpaint submit and status-polling flow", () => {
  test.beforeEach(({ page }) => {
    interceptLabelInstances(page);
  });

  test("submit → poll → completion: inpaint request captured and success toast fires", async ({
    page,
  }) => {
    const inpaintInterceptor = interceptInpaint(page);
    interceptFurnishingsDetection(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    // The new surface's Directions textarea (label = "Directions" — see
    // StagePanel.tsx lines 263–268).
    const directives = page.getByRole("textbox", { name: "Directions" });
    await expect(directives).toBeVisible();
    await directives.fill("Add a neutral linen sofa and a warm wood coffee table.");

    // Switch to Paint area scope so the mask canvas accepts strokes.
    await page.getByRole("radio", { name: "Paint area" }).click();

    const run = page.getByTestId("run-button");
    await expect(run).toBeDisabled();

    await paintMaskZigzag(page);
    await expect(run).toBeEnabled();
    // The route's `directives[roomId]` only updates 900ms after the
    // shell's debounce fires; the cluster's `useInpaintRuns` reads
    // from that prop and its `submitInpaint` validates
    // `promptDirectives.trim()` BEFORE issuing the run. Wait for the
    // autosave status pill to flip back to "Saved" so the route has
    // the typed value before Run fires.
    await waitForDirectivesSaved(page);

    await run.click();

    // Button is disabled while inpaint request is in-flight.
    await expect(run).toBeDisabled();

    // Status polling completes and success toast fires.
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    // Hermetic mock confirmed: the submit payload was captured by interceptInpaint.
    expect(inpaintInterceptor.requestCount()).toBeGreaterThan(0);
    const body = inpaintInterceptor.submitBody();
    expect(body).toHaveProperty("maskUrl");
    expect(body).toHaveProperty("imageUrl");
    expect(body).toHaveProperty("promptDirectives");
  });

  test("submit captures staging directives and mask data in request body", async ({
    page,
  }) => {
    const inpaintInterceptor = interceptInpaint(page);
    interceptFurnishingsDetection(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    const customDirectives = "E2E test furniture placement directive";
    const directives = page.getByRole("textbox", { name: "Directions" });
    await expect(directives).toBeVisible();
    await directives.fill(customDirectives);

    await page.getByRole("radio", { name: "Paint area" }).click();
    await paintMaskZigzag(page);

    const run = page.getByTestId("run-button");
    await expect(run).toBeEnabled();
    // Wait for the route's autosave to settle the typed directives
    // before Run fires (the cluster's `useInpaintRuns` validates
    // `promptDirectives.trim()` against the route's prop, not the
    // shell's local state — the shell's 900ms debounce lands the
    // typed value into the route's `directives[roomId]` only after
    // settle).
    await waitForDirectivesSaved(page);
    await run.click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    const body = inpaintInterceptor.submitBody();
    expect(body.promptDirectives).toBe(customDirectives);
    expect(body.maskUrl).toMatch(/^data:image\/png;base64,/);
    expect(body.imageUrl).toMatch(/^https?:\/\//);
  });
});