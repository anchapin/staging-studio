import { expect, test } from "@playwright/test";

import {
  E2E_EDITOR_PROJECT_ID,
  E2E_UPLOAD_PROJECT_ID,
} from "../env";
import { login, openFocusedEditor } from "../helpers";

/**
 * Breadcrumb navigation (issue #498).
 *
 * Verifies the breadcrumb trail appears on project edit pages in the format:
 *   Projects > [Property Address] > [Room Name (when focused)]
 */
test.describe("breadcrumb navigation", () => {
  test("shows Projects > PropertyAddress on project page", async ({ page }) => {
    await login(page);
    await page.goto(`/projects/${E2E_EDITOR_PROJECT_ID}`);

    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb).toBeVisible();

    // Breadcrumb structure: Projects > PropertyAddress (no room yet)
    await expect(breadcrumb.getByRole("link", { name: "Projects" })).toBeVisible();
    await expect(breadcrumb.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");

    // Property address is shown as current page (no link)
    const propertyAddress = breadcrumb.locator("span.text-foreground").first();
    await expect(propertyAddress).toBeVisible();

    // No room name in breadcrumb when not focused
    await expect(breadcrumb.locator("span.text-foreground")).toHaveCount(1);
  });

  test("shows Projects > PropertyAddress > RoomName when room is focused", async ({ page }) => {
    await login(page);
    await openFocusedEditor(page, E2E_EDITOR_PROJECT_ID, "Mask Room");

    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb).toBeVisible();

    // Three segments: Projects link, PropertyAddress span, RoomName span
    await expect(breadcrumb.getByRole("link", { name: "Projects" })).toBeVisible();
    await expect(breadcrumb.locator("span.text-foreground")).toHaveCount(2);

    // Room name is the last span
    const roomNameSpan = breadcrumb.locator("span.text-foreground").last();
    await expect(roomNameSpan).toContainText("Mask Room");
  });

  test("Projects link navigates to /projects", async ({ page }) => {
    await login(page);
    await page.goto(`/projects/${E2E_UPLOAD_PROJECT_ID}`);

    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    const projectsLink = breadcrumb.getByRole("link", { name: "Projects" });

    await projectsLink.click();
    await page.waitForURL(/\/projects$/);
    await expect(page).toHaveURL(/\/projects$/);
  });
});