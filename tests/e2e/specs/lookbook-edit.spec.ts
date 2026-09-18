import { expect, test } from "@playwright/test";

import { E2E_REHEARSAL_PROJECT_ID, nextEnv } from "../env";
import { interceptExportPdf, interceptGenerateCopy, login } from "../helpers";
import { signPreviewToken } from "../../../src/lib/preview-token";

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

test.describe("lookbook editing (issue #250)", () => {
  const EDIT_URL = `/projects/${E2E_REHEARSAL_PROJECT_ID}/lookbook`;
  const COPY_ROOM = "Lookbook Suite";
  const SEEDED_RECOMMENDATION =
    "Layer warm lamps and lighten textiles to lift the space.";

  async function enterEditMode(page: import("@playwright/test").Page) {
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("button", { name: "Preview" })).toBeVisible();
  }

  test("editing a prose field autosaves and survives a full reload", async ({
    page,
  }) => {
    await login(page);
    await page.goto(EDIT_URL);
    await enterEditMode(page);

    const recommendationBox = page.getByLabel(
      new RegExp(`Recommendation.*${COPY_ROOM}`, "i")
    );
    await expect(recommendationBox).toHaveValue(SEEDED_RECOMMENDATION);

    await recommendationBox.fill(
      "Swap the heavy drapes for sheer linen to brighten the room."
    );
    await recommendationBox.blur();

    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await enterEditMode(page);
    await expect(recommendationBox).toHaveValue(
      "Swap the heavy drapes for sheer linen to brighten the room."
    );
  });
});

test.describe("lookbook export (issue #250)", () => {
  const EXPORT_URL = `/projects/${E2E_REHEARSAL_PROJECT_ID}/lookbook`;
  const COPY_ROOM = "Lookbook Suite";

  test("Export PDF is offered in Preview mode only", async ({ page }) => {
    await login(page);
    await page.goto(EXPORT_URL);

    const exportButton = page.getByRole("button", { name: "Export PDF" });
    await expect(exportButton).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(exportButton).toBeHidden();
  });

  test("exporting from the lookbook page persists pending edits first", async ({
    page,
  }) => {
    interceptExportPdf(page, "success");
    await login(page);
    await page.goto(EXPORT_URL);
    await page.getByRole("button", { name: "Edit" }).click();

    const recommendationBox = page.getByLabel(
      new RegExp(`Recommendation.*${COPY_ROOM}`, "i")
    );
    const revised =
      "Flush-check: brighten with sheer curtains and a wool area rug.";
    await recommendationBox.fill(revised);

    // Preview mode click flushes pending autosaves; Export then runs
    // over a clean slate (the button does not even exist in Edit mode).
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: "Export PDF" }).click();
    await expect(page.getByText("PDF exported successfully!")).toBeVisible();

    // The flushed edit survives a full reload — proof the flush landed
    // before the export round-trip completed.
    await page.reload();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(recommendationBox).toHaveValue(revised);
  });
});

test.describe("lookbook checklist editing and generate-once (issue #250)", () => {
  const URL = `/projects/${E2E_REHEARSAL_PROJECT_ID}/lookbook`;
  const COPY_ROOM = "Lookbook Suite";
  const EMPTY_ROOM = "Rehearsal Room";

  test("checklist text edits, priority changes, and deletes persist", async ({
    page,
  }) => {
    await login(page);
    await page.goto(URL);
    await page.getByRole("button", { name: "Edit" }).click();

    const item1 = page.getByLabel(`Checklist item 1 · ${COPY_ROOM}`, { exact: true });
    await expect(item1).toHaveValue("Replace burnt-out bulbs with warm white");

    await item1.fill("Swap all bulbs for 2700K warm white");
    await page
      .getByLabel(`Priority for checklist item 1 · ${COPY_ROOM}`)
      .selectOption("Standard");
    await item1.blur();
    await expect(page.getByText("Saved")).toBeVisible();

    await page
      .getByRole("button", { name: `Delete checklist item 2 · ${COPY_ROOM}` })
      .click();
    await expect(
      page.getByLabel(`Checklist item 2 · ${COPY_ROOM}`, { exact: true })
    ).toHaveCount(0);
    await item1.blur();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(
      page.getByLabel(`Checklist item 1 · ${COPY_ROOM}`, { exact: true })
    ).toHaveValue("Swap all bulbs for 2700K warm white");
    await expect(
      page.getByLabel(`Priority for checklist item 1 · ${COPY_ROOM}`)
    ).toHaveValue("Standard");
    await expect(
      page.getByLabel(`Checklist item 2 · ${COPY_ROOM}`, { exact: true })
    ).toHaveCount(0);
  });

  test("a copy-less room offers generate-once with no regenerate control", async ({
    page,
  }) => {
    interceptGenerateCopy(page);
    await login(page);
    await page.goto(URL);
    await page.getByRole("button", { name: "Edit" }).click();

    const generate = page.getByRole("button", { name: "Generate copy" });
    await expect(generate).toHaveCount(1);

    await generate.click();
    await expect(
      page.getByLabel(new RegExp(`Observed challenge.*${EMPTY_ROOM}`, "i"))
    ).toHaveValue(/E2E: the room reads as sparse/);
    await expect(
      page.getByLabel(new RegExp(`Recommendation.*${EMPTY_ROOM}`, "i"))
    ).toHaveValue(/E2E: anchor the seating area/);

    // Generate-once: the button (and any regenerate control) is gone.
    await expect(page.getByRole("button", { name: "Generate copy" })).toHaveCount(
      0
    );
    await expect(page.getByText(/regenerate/i)).toHaveCount(0);
  });
});

test.describe("preview page Edit Lookbook link (issue #250)", () => {
  const PREVIEW_URL = `/preview/${E2E_REHEARSAL_PROJECT_ID}`;

  test("owning session sees the Edit Lookbook link and it navigates to the edit page", async ({
    page,
  }) => {
    await login(page);
    await page.goto(PREVIEW_URL);

    const editLink = page.getByRole("link", { name: "Edit Lookbook" });
    await expect(editLink).toBeVisible();
    await editLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${E2E_REHEARSAL_PROJECT_ID}/lookbook$`)
    );
  });

  test("the token path (Browserless capture) never sees the link", async ({
    page,
  }) => {
    process.env.PREVIEW_TOKEN_SECRET = nextEnv().PREVIEW_TOKEN_SECRET;
    const token = await signPreviewToken(E2E_REHEARSAL_PROJECT_ID);

    await page.goto(`${PREVIEW_URL}?token=${encodeURIComponent(token)}`);
    await expect(page.getByText("303 Rehearsal Road").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Edit Lookbook" })
    ).toHaveCount(0);
  });
});

test.describe("lookbook page UX feedback (issue #250 follow-ups)", () => {
  const LOOKBOOK_URL = `/projects/${E2E_REHEARSAL_PROJECT_ID}/lookbook`;

  test("Preview Lookbook on the project page opens the lookbook page in preview mode", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/projects/${E2E_REHEARSAL_PROJECT_ID}`);

    await page.getByRole("link", { name: "Preview Lookbook" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${E2E_REHEARSAL_PROJECT_ID}/lookbook$`)
    );
    await expect(page.getByText("303 Rehearsal Road").first()).toBeVisible();

    // Default mode is Preview: paper rendering, not editors.
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(
      page.getByLabel(/Recommendation · Lookbook Suite/)
    ).toHaveCount(0);
  });

  test("mode toggle and Export stay reachable at the bottom of the page", async ({
    page,
  }) => {
    await login(page);
    await page.goto(LOOKBOOK_URL);

    const editToggle = page.getByRole("button", { name: "Edit" });
    await expect(editToggle).toBeVisible();

    // The dashboard layout scrolls inside #main-content (fixed-height
    // shell, issue #250 feedback) — scroll the real scroll container.
    await page.evaluate(() => {
      const main = document.getElementById("main-content");
      if (main) main.scrollTo(0, main.scrollHeight);
    });

    const toggleY = (await editToggle.boundingBox())?.y ?? 9999;
    expect(toggleY).toBeLessThan(120);

    const exportY =
      (
        await page
          .getByRole("button", { name: "Export PDF" })
          .boundingBox()
      )?.y ?? 9999;
    expect(exportY).toBeLessThan(120);
  });

  test("edit mode shows room imagery and lookbook context alongside editors", async ({
    page,
  }) => {
    await login(page);
    await page.goto(LOOKBOOK_URL);
    await page.getByRole("button", { name: "Edit" }).click();

    const section = page.locator("section", { hasText: "Lookbook Suite" });
    await expect(
      section.getByAltText("Lookbook Suite - Before staging")
    ).toBeVisible();
    await expect(
      section.getByAltText("Lookbook Suite - After staging")
    ).toBeVisible();
    await expect(
      section.getByLabel(/Recommendation · Lookbook Suite/)
    ).toBeVisible();

    // Un-editable lookbook content stays visible for context while editing.
    await expect(page.getByText("Prepared for Rehearsal Client")).toBeVisible();
  });
});
