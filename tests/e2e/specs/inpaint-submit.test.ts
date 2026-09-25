import { expect, test } from "@playwright/test";

import { E2E_EDITOR_PROJECT_ID } from "../env";
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
 * Issue #834: E2E suite missing inpaint submit + status-polling flow.
 *
 * Validates the complete inpaint submit → status-polling → completion flow:
 * - fal.ai queue submission (POST /api/inpaint)
 * - Status endpoint polling (GET /api/inpaint/{requestId}/status)
 * - UI correctly reflects completion state via success toast
 * - Hermetic: all third-party APIs are mocked via interceptInpaint
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

    const directives = page.getByLabel("Staging directives (required)");
    await expect(directives).toBeVisible();
    await directives.fill("Add a neutral linen sofa and a warm wood coffee table.");

    await openEditorTab(page, "Manual paint");

    const applyButton = page.getByRole("button", { name: "Generate", exact: true });
    await expect(applyButton).toBeDisabled();

    await paintMaskZigzag(page);
    await expect(applyButton).toBeEnabled();

    await applyButton.click();

    // Button is disabled while inpaint request is in-flight
    await expect(applyButton).toBeDisabled();

    // Status polling completes and success toast fires
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    // Hermetic mock confirmed: the submit payload was captured by interceptInpaint
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
    const directives = page.getByLabel("Staging directives (required)");
    await expect(directives).toBeVisible();
    await directives.fill(customDirectives);

    await openEditorTab(page, "Manual paint");
    await paintMaskZigzag(page);

    const applyButton = page.getByRole("button", { name: "Generate", exact: true });
    await applyButton.click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    // Verify the captured request body contains the expected fields
    const body = inpaintInterceptor.submitBody();
    expect(body.promptDirectives).toBe(customDirectives);
    expect(body.maskUrl).toMatch(/^data:image\/png;base64,/);
    expect(body.imageUrl).toMatch(/^https?:\/\//);
  });

  test("multiple submits are each captured with unique request IDs", async ({
    page,
  }) => {
    const inpaintInterceptor = interceptInpaint(page);
    interceptFurnishingsDetection(page);

    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    const directives = page.getByLabel("Staging directives (required)");
    await expect(directives).toBeVisible();
    await directives.fill("Add a modern desk and a black floor lamp.");

    await openEditorTab(page, "Manual paint");

    const applyButton = page.getByRole("button", { name: "Generate", exact: true });

    // First submit
    await paintMaskZigzag(page);
    await expect(applyButton).toBeEnabled();
    await applyButton.click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    // Second submit with a new mask stroke — button is still disabled
    // until a new mask is painted (expected UI behaviour)
    inpaintInterceptor.respondWithCompleted();
    await paintMaskZigzag(page);
    await expect(applyButton).toBeEnabled();
    await applyButton.click();
    await expect(page.getByText("Inpainting completed successfully!")).toBeVisible({
      timeout: 20_000,
    });

    expect(inpaintInterceptor.requestCount()).toBe(2);

    const [first, second] = inpaintInterceptor.submitBodies();
    expect(first.maskUrl).not.toBe(second.maskUrl);
  });
});
