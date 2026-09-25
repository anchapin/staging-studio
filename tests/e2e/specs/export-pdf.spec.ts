import { test, expect, type Page } from "@playwright/test";

import { login } from "../helpers";
import { E2E_UPLOAD_PROJECT_ID } from "../env";

const EXPORT_PDF_URL = "/api/export-pdf";

function minimalPdfBytes(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj trailer<</Root 1 0 R>>%%EOF"
  );
}

function interceptBrowserlessPdf(
  page: Page,
  outcome: "success" | "outage"
): void {
  page.route("**/chrome.browserless.io/pdf**", (route) => {
    if (outcome === "outage") {
      void route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Browserless unavailable" }),
      });
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: minimalPdfBytes(),
    });
  });
}

test.describe("export-pdf API route", () => {
  test("POST with valid projectId returns a PDF", async ({ page }) => {
    await login(page);
    interceptBrowserlessPdf(page, "success");

    const response = await page.request.post(EXPORT_PDF_URL, {
      data: { projectId: E2E_UPLOAD_PROJECT_ID },
    });

    expect(response.status()).toBe(200);
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/pdf");

    const buffer = await response.body();
    expect(buffer.length).toBeGreaterThan(0);
  });

  test("POST with missing projectId returns 400", async ({ page }) => {
    await login(page);

    const response = await page.request.post(EXPORT_PDF_URL, {
      data: {},
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid_project_id");
  });

  test("POST with malformed projectId returns 400", async ({ page }) => {
    await login(page);

    const response = await page.request.post(EXPORT_PDF_URL, {
      data: { projectId: "not-a-cuid-format" },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid_project_id");
  });

  test("unauthenticated POST returns 401", async ({ page }) => {
    const response = await page.request.post(EXPORT_PDF_URL, {
      data: { projectId: E2E_UPLOAD_PROJECT_ID },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("unauthorized");
  });

  test("Browserless outage returns 500 from the route", async ({ page }) => {
    await login(page);
    interceptBrowserlessPdf(page, "outage");

    const response = await page.request.post(EXPORT_PDF_URL, {
      data: { projectId: E2E_UPLOAD_PROJECT_ID },
    });

    expect(response.status()).toBe(500);
  });
});
