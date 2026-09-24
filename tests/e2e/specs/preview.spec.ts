import { expect, test } from "@playwright/test";

import { E2E_REHEARSAL_PROJECT_ID, nextEnv } from "../env";
import { login } from "../helpers";
import { signPreviewToken } from "../../../src/lib/preview-token";

// The app under test signs/verifies preview tokens with the secret from
// nextEnv() (see playwright.config.ts's webServer). preview-token.ts reads
// PREVIEW_TOKEN_SECRET at call time, so setting it here makes in-spec
// minting match the app's verification key.
process.env.PREVIEW_TOKEN_SECRET = nextEnv().PREVIEW_TOKEN_SECRET;

const PREVIEW_URL = `/preview/${E2E_REHEARSAL_PROJECT_ID}`;
// Seeded in tests/e2e/global-setup.ts; rendered on the lookbook cover page.
const SEEDED_ADDRESS = "303 Rehearsal Road";

/**
 * Lookbook preview access (issue #254). The page grants access when EITHER
 * a valid signed token is present (Browserless PDF-export path) OR the
 * request carries an authenticated session whose user owns the project.
 * Everything else 404s — no existence leak.
 *
 * Hermetic: the mock Supabase backs the session scenario, and the token is
 * minted in-spec with the same HMAC secret the app verifies against. No
 * third-party provider is contacted.
 */
test.describe("lookbook preview access (issue #254)", () => {
  test("logged-in session renders the lookbook without a token", async ({
    page,
  }) => {
    await login(page);

    const response = await page.goto(PREVIEW_URL);
    expect(response?.status()).toBe(200);
    await expect(page.getByText(SEEDED_ADDRESS).first()).toBeVisible();

    // The URL stayed tokenless — the human button flow, not the export flow.
    expect(page.url()).not.toContain("token=");
  });

  test("anonymous without a token gets a 404", async ({ page }) => {
    const response = await page.goto(PREVIEW_URL);
    expect(response?.status()).toBe(404);
  });

  test("anonymous with a valid minted token renders the lookbook", async ({
    page,
  }) => {
    const token = await signPreviewToken(E2E_REHEARSAL_PROJECT_ID);

    const response = await page.goto(
      `${PREVIEW_URL}?token=${encodeURIComponent(token)}`
    );
    expect(response?.status()).toBe(200);
    await expect(page.getByText(SEEDED_ADDRESS).first()).toBeVisible();
  });
});
