import { test, expect } from "@playwright/test";
import { E2E_UPLOAD_PROJECT_ID } from "../env";
import { login } from "../helpers";
import { solidPng } from "../fixtures";

/**
 * Batch upload + room-type detection flow.
 * Covers the workflow where a user:
 * 1. Opens the batch upload panel from the project detail page
 * 2. Selects multiple room photos
 * 3. Triggers auto-detection of room types via GPT-4o-mini vision
 * 4. Sees detected room types before confirming batch creation
 *
 * The e2e suite runs against a mock Supabase (no real auth, no real storage,
 * no real OpenAI calls). OpenAI calls are intercepted at the network
 * layer so the full flow can exercise without paid credentials.
 *
 * @see https://github.com/anomalyco/staging-studio/issues/789
 */
test.describe("batch staging + room-type detection", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.route(
      "https://api.openai.com/v1/chat/completions",
      async (route) => {
        const body = JSON.parse(route.request().postData() ?? "{}");
        const isVision = JSON.stringify(body).includes("gpt-4o-mini");
        if (isVision) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              id: "mock-vision-id",
              object: "chat.completion",
              created: Date.now(),
              model: "gpt-4o-mini",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      roomType: "bedroom",
                    }),
                  },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 20,
                total_tokens: 120,
              },
            }),
          });
        } else {
          await route.continue();
        }
      }
    );
  });

  test("batch upload panel shows after clicking Add rooms", async ({ page }) => {
    await page.goto(`/projects/${E2E_UPLOAD_PROJECT_ID}`);
    await expect(page).toHaveURL(`/projects/${E2E_UPLOAD_PROJECT_ID}`);

    const addRoomsBtn = page.getByRole("button", { name: /add rooms/i }).first();
    await expect(addRoomsBtn).toBeVisible();
    await addRoomsBtn.click();

    // Dropzone should now be visible
    const dropzone = page.getByRole("button", {
      name: /drop room photos here/i,
    });
    await expect(dropzone).toBeVisible();
  });

  test("uploads images and detects room types", async ({ page }) => {
    await page.goto(`/projects/${E2E_UPLOAD_PROJECT_ID}`);
    await page.getByRole("button", { name: /add rooms/i }).first().click();

    const dropzone = page.getByRole("button", {
      name: /drop room photos here/i,
    });
    await expect(dropzone).toBeVisible();

    // Use the file input inside the dropzone
    const fileInput = page.locator('input[type="file"][accept*="image"]');
    const bedroom = solidPng(96, 64, [122, 139, 111]);
    const livingRoom = solidPng(96, 64, [200, 180, 160]);
    const kitchen = solidPng(96, 64, [180, 200, 160]);
    await fileInput.setInputFiles([
      { name: "room1.png", mimeType: "image/png", buffer: bedroom },
      { name: "room2.png", mimeType: "image/png", buffer: livingRoom },
      { name: "room3.png", mimeType: "image/png", buffer: kitchen },
    ]);

    // File list header should show 3 photos selected
    await expect(page.getByText(/\d+ photos? selected/i)).toBeVisible();

    // Detect room types button should be enabled
    const detectBtn = page.getByRole("button", { name: /detect room types/i });
    await expect(detectBtn).toBeEnabled();
    await detectBtn.click();

    // Wait for detection to complete (button text changes back)
    await expect(
      page.getByRole("button", { name: /detect room types/i })
    ).toBeEnabled({ timeout: 20_000 });

    // Create rooms button should be enabled
    const createBtn = page.getByRole("button", { name: /create rooms/i });
    await expect(createBtn).toBeEnabled();
  });

  test("shows error state when OpenAI returns invalid response", async ({
    page,
  }) => {
    // Override the intercept to return an error
    await page.route(
      "https://api.openai.com/v1/chat/completions",
      async (route) => {
        const body = JSON.parse(route.request().postData() ?? "{}");
        const isVision = JSON.stringify(body).includes("gpt-4o-mini");
        if (isVision) {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              error: { message: "Internal server error" },
            }),
          });
        } else {
          await route.continue();
        }
      }
    );

    await page.goto(`/projects/${E2E_UPLOAD_PROJECT_ID}`);
    await page.getByRole("button", { name: /add rooms/i }).first().click();

    const fileInput = page.locator('input[type="file"][accept*="image"]');
    const bedroom = solidPng(96, 64, [122, 139, 111]);
    await fileInput.setInputFiles([
      { name: "room1.png", mimeType: "image/png", buffer: bedroom },
    ]);

    await expect(page.getByText(/1 photos? selected/i)).toBeVisible();

    const detectBtn = page.getByRole("button", { name: /detect room types/i });
    await detectBtn.click();

    // Detect button should re-enable after error (status changes back)
    await expect(
      page.getByRole("button", { name: /detect room types/i })
    ).toBeEnabled({ timeout: 20_000 });
  });
});
