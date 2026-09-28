import { test, expect } from "@playwright/test";

import { login, mockBrowserlessRequests, setMockBrowserlessOutcome } from "../helpers";
import { E2E_UPLOAD_PROJECT_ID } from "../env";

const EXPORT_PDF_URL = "/api/export-pdf";

/**
 * Direct-API suite for `POST /api/export-pdf` (issue #1084).
 *
 * Unlike `export.spec.ts` — which mocks the app's own `/api/export-pdf`
 * route and so only exercises client-side toast rendering — every test
 * here runs the
 * REAL route handler, covering session auth, cuid validation, project
 * ownership, the daily quota, the signed preview token, the verified-PDF
 * guard, and upstream-status mapping.
 *
 * That meant these tests could not mock Browserless with a
 * `page.route` glob on `chrome.browserless.io/pdf`: the handler's fetch
 * runs in the Next.js SERVER process, and `page.route` only sees
 * browser-context traffic. The interception silently never fired, so the
 * real Browserless API was called with a dummy key and answered 401 —
 * the two failures this suite now fixes. The endpoint instead resolves
 * to the local mock via the hermetic-gated `E2E_BROWSERLESS_PDF_URL`
 * override (see `mock-browserless.ts`).
 */
test.describe("export-pdf API route", () => {
  // Default to the success path; the outage drill opts in explicitly so a
  // failure can't leak into the next test (the mock is process-wide).
  test.beforeEach(async () => {
    await setMockBrowserlessOutcome("success");
  });

  test("POST with valid projectId returns a PDF", async ({ page }) => {
    await login(page);
    await setMockBrowserlessOutcome("success");

    const response = await page.request.post(EXPORT_PDF_URL, {
      data: { projectId: E2E_UPLOAD_PROJECT_ID },
    });

    expect(response.status()).toBe(200);
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/pdf");

    const buffer = await response.body();
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");

    // The real handler reached the (mock) provider, sending the API key
    // in the Authorization header and a signed, project-scoped preview
    // URL in the body — never in the query string.
    const [captured] = await mockBrowserlessRequests();
    expect(captured?.method).toBe("POST");
    expect(captured?.authorization).toBe(
      `Basic ${Buffer.from("e2e-dummy-browserless-key:").toString("base64")}`
    );
    expect(captured?.url).not.toContain("e2e-dummy-browserless-key");
    const body = JSON.parse(captured?.body ?? "{}") as { url?: string };
    expect(body.url).toContain(`/preview/${E2E_UPLOAD_PROJECT_ID}?token=`);
  });

  // Issue #1080: the route returns the unified API_ERROR_INVALID_REQUEST
  // code ("invalid-request") for both missing and malformed projectId;
  // the test was previously asserting the never-shipped
  // "invalid_project_id" code from an earlier draft of the hardening.
  // Assert on the stable message instead — it's specific to this route
  // and won't drift on shared error-handler refactors.
  test("POST with missing projectId returns 400", async ({ page }) => {
    await login(page);

    const response = await page.request.post(EXPORT_PDF_URL, {
      data: {},
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("projectId must be a valid CUID");
  });

  test("POST with malformed projectId returns 400", async ({ page }) => {
    await login(page);

    const response = await page.request.post(EXPORT_PDF_URL, {
      data: { projectId: "not-a-cuid-format" },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("projectId must be a valid CUID");
  });

  test("unauthenticated POST returns 401", async ({ page }) => {
    const response = await page.request.post(EXPORT_PDF_URL, {
      data: { projectId: E2E_UPLOAD_PROJECT_ID },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("unauthorized");
  });

  test("Browserless outage propagates the upstream status from the route", async ({
    page,
  }) => {
    await login(page);
    await setMockBrowserlessOutcome("outage");

    const response = await page.request.post(EXPORT_PDF_URL, {
      data: { projectId: E2E_UPLOAD_PROJECT_ID },
    });

    // Issue #1084: this asserted 500, but the route's generic non-ok
    // branch returns `{ status: chromeResponse.status }` — it PROPAGATES
    // the provider status rather than normalizing to 500 (only 401/403
    // and 429 get dedicated branches). A provider 503 therefore surfaces
    // as 503. This was a latent second defect, independent of the
    // interception bug: it would have failed even with a working mock.
    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("pdf-generation-failed");
    expect(body.retryable).toBe(true);
  });
});
