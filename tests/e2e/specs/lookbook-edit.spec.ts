import { expect, test } from "@playwright/test";

import { E2E_REHEARSAL_PROJECT_ID } from "../env";
import { login } from "../helpers";

// Seeded in tests/e2e/global-setup.ts: the rehearsal project is the only
// one the preview spec also exercises; its cover renders the address and
// its single room renders by name.
const LOOKBOOK_URL = `/projects/${E2E_REHEARSAL_PROJECT_ID}/lookbook`;
const SEEDED_ADDRESS = "303 Rehearsal Road";
const SEEDED_ROOM = "Rehearsal Room";

/**
 * Lookbook page access (issue #250). The page lives under /projects so
 * middleware's protected prefix already redirects anonymous visitors to
 * /login — no auth changes anywhere. An owning session renders the same
 * lookbook components as /preview/[id], in a letter-proportioned paper
 * preview.
 */
test.describe("lookbook page access (issue #250)", () => {
  test("anonymous visitor is redirected to /login by the projects prefix", async ({
    page,
  }) => {
    await page.goto(LOOKBOOK_URL);
    await expect(page).toHaveURL(/\/login/);
  });

  test("owning session renders the lookbook paper preview", async ({
    page,
  }) => {
    await login(page);

    const response = await page.goto(LOOKBOOK_URL);
    expect(response?.status()).toBe(200);

    // Cover page content…
    await expect(page.getByText(SEEDED_ADDRESS).first()).toBeVisible();
    // …and the room spread heading, proving room data reached the view.
    await expect(page.getByRole("heading", { name: SEEDED_ROOM })).toBeVisible();
  });
});
