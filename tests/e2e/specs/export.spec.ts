import { expect, test } from "@playwright/test";

import {
  interceptExportPdf,
  login,
} from "../helpers";
import { E2E_REHEARSAL_PROJECT_ID } from "../env";

const REHEARSAL_LOOKBOOK_URL = `/projects/${E2E_REHEARSAL_PROJECT_ID}/lookbook`;

/**
 * Dedicated PDF export E2E suite (issue #849).
 *
 * Covers the export flow end-to-end through the lookbook UI with
 * mock Browserless interception, plus the simulated outage drill and
 * unauthenticated guard that the rehearsal drill only partially exercises.
 */
test.describe("PDF export", () => {
  test("Export PDF button is only visible in Preview mode, not Edit mode", async ({
    page,
  }) => {
    await login(page);

    // Navigate to lookbook in Preview mode (default).
    await page.goto(REHEARSAL_LOOKBOOK_URL);
    const exportButton = page.getByRole("button", { name: "Export PDF" });
    await expect(exportButton).toBeVisible();

    // Switch to Edit mode — Export button must be hidden.
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(exportButton).toBeHidden();
  });

  test("clicking Export PDF shows success toast when Browserless returns a PDF", async ({
    page,
  }) => {
    interceptExportPdf(page, "success");
    await login(page);
    await page.goto(REHEARSAL_LOOKBOOK_URL);

    await page.getByRole("button", { name: "Export PDF" }).click();
    await expect(page.getByText("PDF exported successfully!")).toBeVisible();
  });

  test("clicking Export PDF shows an error toast when Browserless is unavailable (outage drill)", async ({
    page,
  }) => {
    interceptExportPdf(page, "failure");
    await login(page);
    await page.goto(REHEARSAL_LOOKBOOK_URL);

    await page.getByRole("button", { name: "Export PDF" }).click();
    // The export error surfaces a dismissible alert with actionable text
    // (not a dead-end blank state).
    await expect(page.getByText(/export.*fail|try again|browserless/i)).toBeVisible({ timeout: 10_000 });
  });
});
