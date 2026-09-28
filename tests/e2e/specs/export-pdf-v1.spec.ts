import { test, expect } from "@playwright/test";

import { login, mockBrowserlessRequests, setMockBrowserlessOutcome } from "../helpers";
import {
  E2E_ABSENT_PROJECT_ID,
  E2E_DAILY_EXPORT_LIMIT,
  E2E_UPLOAD_PROJECT_ID,
} from "../env";
import type { CapturedBrowserlessRequest } from "../mock-browserless";
import { withExportUsageAtLimit } from "../quota";

const EXPORT_PDF_V1_URL = "/api/v1/export-pdf";

/**
 * Direct-API suite for `GET /api/v1/export-pdf` (the v1 sibling of the
 * suite in `export-pdf.spec.ts`).
 *
 * The versioned route is NOT a superset of the unversioned one: it is a
 * `GET` with a `?projectId=` query param, it adds a daily export quota
 * (429) and a project-ownership check (403/404) that the unversioned
 * route does not perform, and it answers every response — success and
 * error alike — with an `X-Supabase-API-Version: v1` header (renamed from
 * `API-Version` by #1018, which lives on main and is already in Production).
 * Its error mapping also
 * DIVERGES where it matters: an upstream provider failure is flattened to
 * a 500 `invalid-request`, whereas the unversioned route propagates the
 * provider's own status (a 503 stays a 503). Both are pinned below.
 *
 * Why this suite can drive the REAL handler at all: the handler's
 * outbound Browserless fetch runs in the Next.js SERVER process, so a
 * `page.route` glob on `chrome.browserless.io/pdf` can never intercept it
 * (it silently misses, and the suite ends up calling the real paid API
 * with a dummy key). The endpoint instead resolves to the local mock via
 * the hermetic-gated `E2E_BROWSERLESS_PDF_URL` override that
 * `resolveBrowserlessPdfUrl` provides. This spec is the first consumer
 * of that seam on the v1 route.
 *
 * Not covered here: the 403 branch. Every seeded project belongs to
 * E2E_USER_ID, so reaching it needs a second user with a matching GoTrue
 * identity the mock auth server does not issue. The 429 branch IS
 * covered — see the quota test at the bottom and `quota.ts`.
 */
test.describe("export-pdf v1 API route", () => {
  // The mock is process-wide and its outcome survives between tests, so
  // default every test to the success path; the outage drill opts in
  // explicitly so it can't leak into a later test.
  test.beforeEach(async () => {
    await setMockBrowserlessOutcome("success");
  });

  test("GET with valid projectId returns a PDF and version headers", async ({ page }) => {
    await login(page);
    const before = await mockBrowserlessRequests();

    const response = await page.request.get(
      `${EXPORT_PDF_V1_URL}?projectId=${E2E_UPLOAD_PROJECT_ID}`
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] ?? "").toContain("application/pdf");
    expect(response.headers()["content-disposition"]).toBe(
      `attachment; filename="staging-report-${E2E_UPLOAD_PROJECT_ID}.pdf"`
    );
    // The route stamps every branch with buildVersionHeaders("v1").
    expect(response.headers()["x-supabase-api-version"]).toBe("v1");

    const buffer = await response.body();
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");

    // The real handler reached the (mock) provider, sending the API key
    // in the Authorization header and a signed, project-scoped preview
    // URL in the body — never in the query string.
    const fresh = await freshBrowserlessRequests(before);
    expect(fresh).toHaveLength(1);
    const [captured] = fresh;
    expect(captured.method).toBe("POST");
    expect(captured.authorization).toBe(
      `Basic ${Buffer.from("e2e-dummy-browserless-key:").toString("base64")}`
    );
    expect(captured.url).not.toContain("e2e-dummy-browserless-key");
    const body = JSON.parse(captured.body ?? "{}") as { url?: string };
    expect(body.url).toContain(`/preview/${E2E_UPLOAD_PROJECT_ID}?token=`);
  });

  test("unauthenticated GET returns 401", async ({ page }) => {
    const response = await page.request.get(
      `${EXPORT_PDF_V1_URL}?projectId=${E2E_UPLOAD_PROJECT_ID}`
    );

    expect(response.status()).toBe(401);
    expect(response.headers()["x-supabase-api-version"]).toBe("v1");
    const body = await response.json();
    expect(body.code).toBe("unauthorized");
  });

  test("GET with missing projectId returns 400", async ({ page }) => {
    await login(page);

    const response = await page.request.get(EXPORT_PDF_V1_URL);

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid-request");
    expect(body.message).toContain("projectId must be a valid CUID");
  });

  test("GET with malformed projectId returns 400 before the ownership lookup", async ({
    page,
  }) => {
    await login(page);

    const response = await page.request.get(
      `${EXPORT_PDF_V1_URL}?projectId=not-a-cuid-format`
    );

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("projectId must be a valid CUID");
  });

  // The cuid-shape guard is what keeps a malformed id out of the
  // ownership lookup, so this id is cuid-shaped too: it must fail as
  // "not found", not as a 400.
  test("GET with a well-formed but unseeded projectId returns 404", async ({ page }) => {
    await login(page);
    const before = await mockBrowserlessRequests();

    const response = await page.request.get(
      `${EXPORT_PDF_V1_URL}?projectId=${E2E_ABSENT_PROJECT_ID}`
    );

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("project-not-found");
    // Ownership is checked before the token is minted and before the
    // provider is called, so a 404 must not have cost a Browserless call.
    expect(await freshBrowserlessRequests(before)).toHaveLength(0);
  });

  test("Browserless outage is flattened to 500, not propagated", async ({ page }) => {
    await login(page);
    await setMockBrowserlessOutcome("outage");

    const response = await page.request.get(
      `${EXPORT_PDF_V1_URL}?projectId=${E2E_UPLOAD_PROJECT_ID}`
    );

    // DIVERGENCE from the unversioned route, which propagates the
    // provider's status (its generic non-ok branch returns
    // `{ status: chromeResponse.status }`, so a 503 stays a 503). This
    // route's equivalent branch hard-codes 500, so the mock's 503
    // surfaces as 500. Pinned deliberately: if someone "fixes" this to
    // match the sibling route, this test is the tripwire.
    expect(response.status()).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("invalid-request");
    expect(body.error).toBe("PDF generation failed");
  });

  // The daily-quota guard sits BEFORE the ownership lookup and before the
  // provider call, which makes it the one error branch a single-user
  // suite can reach: no second GoTrue identity required, just a counter
  // at the cap. `withExportUsageAtLimit` writes the `DailyApiUsage` row
  // and restores it afterwards, so the later-running `export-pdf.spec.ts`
  // (which drives the real unversioned handler) still exports normally.
  test("exhausted daily export quota returns 429 without calling the provider", async ({
    page,
  }) => {
    await login(page);
    const before = await mockBrowserlessRequests();

    const { status, apiVersion, body } = await withExportUsageAtLimit(async () => {
      const response = await page.request.get(
        `${EXPORT_PDF_V1_URL}?projectId=${E2E_UPLOAD_PROJECT_ID}`
      );
      return {
        status: response.status(),
        apiVersion: response.headers()["x-supabase-api-version"],
        body: (await response.json()) as {
          success: boolean;
          code: string;
          error: string;
          retryable: boolean;
          used: number;
          limit: number;
          resetsAt: string;
        },
      };
    });

    expect(status).toBe(429);
    // Even the refusal carries the version header — the route stamps
    // `versionInfo` on every branch, which is the point of the API.
    expect(apiVersion).toBe("v1");
    expect(body.success).toBe(false);
    expect(body.code).toBe("rate-limit-exceeded");
    expect(body.error).toBe("Daily limit reached");
    // `retryable` is what tells an API client the 429 is a quota window,
    // not a broken request.
    expect(body.retryable).toBe(true);
    // Tripwire: `E2E_DAILY_EXPORT_LIMIT` mirrors the app default rather
    // than importing it, so if DEFAULT_DAILY_EXPORT_LIMIT ever moves,
    // the seeded row and the route's own reported limit disagree and this
    // fails here instead of quietly no-op-ing.
    expect(body.used).toBe(E2E_DAILY_EXPORT_LIMIT);
    expect(body.limit).toBe(E2E_DAILY_EXPORT_LIMIT);
    expect(Number.isNaN(Date.parse(body.resetsAt))).toBe(false);

    // Quota is checked first, so a refusal must not have minted a
    // preview token or billed the provider.
    expect(await freshBrowserlessRequests(before)).toHaveLength(0);
  });
});

/**
 * The mock's captured-request log is process-wide and persists for the
 * whole suite run, and `workers: 1` makes specs sequential — so this
 * test's own provider calls are exactly the ones appended after
 * `before`. Indexing the log from 0 would pick up an earlier spec's
 * calls; taking the last element would work but would not catch a
 * handler that fired the provider twice.
 */
async function freshBrowserlessRequests(
  before: CapturedBrowserlessRequest[]
): Promise<CapturedBrowserlessRequest[]> {
  const after = await mockBrowserlessRequests();
  return after.slice(before.length);
}
