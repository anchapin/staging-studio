import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { test, expect } from "@playwright/test";

import { login, mockBrowserlessRequests, setMockBrowserlessOutcome } from "../helpers";
import { E2E_UPLOAD_PROJECT_ID } from "../env";

/**
 * Print-CSS regression baseline (issue #1222).
 *
 * Captures ONE Browserless export through the REAL /api/export-pdf handler
 * (resolved to the local mock Browserless via the hermetic override, same
 * mechanism as export-pdf.spec.ts) and saves the bytes to
 * test-results/lookbook-print-baseline.pdf as the known-good reference for
 * future @page / print-CSS regressions.
 *
 * Deliberately asserts only on file presence, the %PDF header, and a
 * non-zero page count: any stronger CSS assertion (margins, footer size,
 * page-break placement) belongs in tests/print-css.test.ts and in the
 * audit doc, not in a captured artifact, so this spec stays stable across
 * pure-CSS changes.
 *
 * Note: in the hermetic e2e environment the "Browserless" endpoint is the
 * local mock, so the baseline bytes are the mock's minimal fixture PDF,
 * not a real render. Where a real BROWSERLESS_API_KEY is configured the
 * same spec captures the real render unchanged.
 */

const BASELINE_PATH = join(process.cwd(), "test-results", "lookbook-print-baseline.pdf");

test.describe("lookbook print baseline", () => {
  test.beforeEach(async () => {
    await setMockBrowserlessOutcome("success");
  });

  test("captures the print baseline PDF with a non-zero page count", async ({ page }) => {
    await login(page);

    const response = await page.request.post("/api/export-pdf", {
      data: { projectId: E2E_UPLOAD_PROJECT_ID },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] ?? "").toContain("application/pdf");

    const buffer = await response.body();
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");

    // The capture request reached the provider with the signed preview URL
    // marked as the PDF capture path (issue #1222), so the print CSS keeps
    // the render full-bleed.
    const [captured] = await mockBrowserlessRequests();
    const body = JSON.parse(captured?.body ?? "{}") as { url?: string };
    expect(body.url).toContain("capture=pdf");

    mkdirSync(join(process.cwd(), "test-results"), { recursive: true });
    writeFileSync(BASELINE_PATH, buffer);

    const saved = readFileSync(BASELINE_PATH);
    expect(saved.length).toBe(buffer.length);
    // Non-zero page count, stable across CSS changes: count page objects,
    // distinguishing /Type/Page from /Type/Pages.
    const text = saved.toString("latin1");
    const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(0);
  });
});
