import { expect, test } from "@playwright/test";

import {
  E2E_REHEARSAL_PROJECT_ID,
  E2E_UPLOAD_PROJECT_ID,
} from "../env";
import { login } from "../helpers";

/**
 * Atelier Canvas studio workflow shell (issue #709; surfaces from
 * #612/#679, #620, #619).
 *
 * Pins the 4-step pipeline at the browser level:
 *   1. Client Project Setup   — consultation action bar (sticky #619)
 *   2. Room Batch Stage       — workbench shell + dock (#620)
 *   3. Brush Refinement       — split-canvas studio
 *   4. Consultation Report    — client-facing report
 *
 * The happy-path test walks 1→4 through the real CTAs (action-bar primary
 * CTA → workbench dock "Send to Brush Refinement" → stepper chip) and
 * asserts the report renders (document 200 + expected heading + the
 * staged showcase earned on the way). The gate test pins the state
 * machine's locks on a fresh project: the Step-2 dock CTA stays disabled
 * until a room has a staged variant, and a direct jump to Step 4 yields
 * the empty showcase, never a fabricated report.
 *
 * Seeding notes: the rehearsal project's "Lookbook Suite" room is seeded
 * with a before/after pair, so its workbench dock is unlocked ("ready")
 * from the start; the upload project is photo-less, so its dock is locked
 * ("0 of 1 room staged") regardless of spec ordering (upload.spec runs
 * after this spec alphabetically and only ever adds before photos).
 */
test.describe("Atelier studio workflow shell", () => {
  const REHEARSAL = `/projects/${E2E_REHEARSAL_PROJECT_ID}`;
  const UPLOAD = `/projects/${E2E_UPLOAD_PROJECT_ID}`;

  test("walks steps 1→4 and reaches the consultation report CTA", async ({
    page,
  }) => {
    await login(page);

    // ---- Step 1: Client Project Setup ------------------------------
    const response = await page.goto(`${REHEARSAL}/setup`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByText("Step 1 of 4 — Client Project Setup")
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "303 Rehearsal Road" })
    ).toBeVisible();

    // Workflow shell: the stepper exposes the full step graph (issue #612).
    const stepper = page.getByRole("navigation", {
      name: "Studio workflow steps",
    });
    await expect(stepper).toBeVisible();
    await expect(
      stepper.getByRole("link", { name: "Client Setup" })
    ).toHaveAttribute("href", `${REHEARSAL}/setup`);
    await expect(
      stepper.getByRole("link", { name: "Room Batch" })
    ).toHaveAttribute("href", `${REHEARSAL}/rooms`);
    await expect(
      stepper.getByRole("link", { name: "Brush Refinement" })
    ).toHaveAttribute("href", `${REHEARSAL}/refine`);
    await expect(
      stepper.getByRole("link", { name: "Report & Export" })
    ).toHaveAttribute("href", `${REHEARSAL}/report`);
    await expect(
      stepper.getByRole("link", { name: "Client Setup" })
    ).toHaveAttribute("aria-current", "step");

    // ---- Consultation action bar (issue #619) ----------------------
    // Viewport-fixed at the bottom of Step 1 and stays pinned while the
    // intake form scrolls underneath it.
    const actionBar = page.locator('footer[aria-label="Consultation actions"]');
    await expect(actionBar).toBeVisible();
    await expect(actionBar.getByText("Configured:")).toBeVisible();
    await expect(
      actionBar.getByRole("button", { name: "Save Draft" })
    ).toBeEnabled();

    const barPosition = await actionBar.evaluate(
      (el) => window.getComputedStyle(el).position
    );
    expect(barPosition).toBe("fixed");
    const pinnedBefore = await actionBar.evaluate(
      (el) => window.innerHeight - el.getBoundingClientRect().bottom
    );
    expect(pinnedBefore).toBeLessThanOrEqual(1);

    await page.evaluate(() => {
      document.querySelector("#main-content")?.scrollTo({ top: 800 });
      window.scrollTo(0, 800);
    });
    const pinnedAfter = await actionBar.evaluate(
      (el) => window.innerHeight - el.getBoundingClientRect().bottom
    );
    expect(pinnedAfter).toBeLessThanOrEqual(1);
    expect(pinnedAfter).toBe(pinnedBefore);

    // Primary CTA advances the workflow to Step 2.
    await actionBar
      .getByRole("button", { name: "Save & Proceed to Room Batch Stage" })
      .click();
    await page.waitForURL(new RegExp(`${REHEARSAL}/rooms$`));

    // ---- Step 2: workbench shell (issue #620) ----------------------
    await expect(
      page.getByText("Step 2 of 4 — Room Batch Stage & AI Generation")
    ).toBeVisible();
    await expect(
      page.locator('aside[aria-label="Room hierarchy sidebar"]')
    ).toBeVisible();
    await expect(
      page.locator('[aria-label="Global staging directives"]')
    ).toBeVisible();
    await expect(
      stepper.getByRole("link", { name: "Room Batch" })
    ).toHaveAttribute("aria-current", "step");

    // Bottom dock: sticky WITHIN the workspace scroll container, never
    // viewport-fixed (issue #620 acceptance criterion).
    const dock = page.locator("[data-workbench-dock]");
    await expect(dock).toBeVisible();
    const dockPosition = await dock.evaluate(
      (el) => window.getComputedStyle(el).position
    );
    expect(dockPosition).toBe("sticky");

    // The seeded Lookbook Suite pair keeps the dock unlocked.
    await expect(dock.getByText("Session Ready")).toBeVisible();
    await expect(dock.getByRole("status")).toHaveText(/of 2 rooms staged/);
    const sendCta = dock.getByRole("button", {
      name: "Send to Brush Refinement",
    });
    await expect(sendCta).toBeEnabled();

    // Dock CTA advances the workflow to Step 3, room-scoped.
    await sendCta.click();
    await page.waitForURL(new RegExp(`${REHEARSAL}/refine\\?room=`));

    // ---- Step 3: Brush Refinement ---------------------------------
    await expect(
      stepper.getByRole("link", { name: "Brush Refinement" })
    ).toHaveAttribute("aria-current", "step");
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" })
    ).toBeVisible();

    // Step 4 is reached via the stepper chip — the shell's navigable
    // step graph (src/lib/studio-workflow.ts) exercised in the browser.
    await stepper.getByRole("link", { name: "Report & Export" }).click();
    await page.waitForURL(new RegExp(`${REHEARSAL}/report$`));

    // ---- Step 4: Consultation Report -------------------------------
    await expect(
      page.getByText("Step 4 of 4 — Client Consultation Report & Export")
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "303 Rehearsal Road" })
    ).toBeVisible();
    await expect(
      stepper.getByRole("link", { name: "Report & Export" })
    ).toHaveAttribute("aria-current", "step");
    // The showcase the walk earned: the seeded staged room renders.
    await expect(
      page.getByRole("heading", { name: "Lookbook Suite" })
    ).toBeVisible();

    // Hard document navigation confirms the report route serves 200.
    const reportResponse = await page.goto(`${REHEARSAL}/report`);
    expect(reportResponse?.status()).toBe(200);
  });

  test("fresh project cannot skip ahead to the report", async ({ page }) => {
    await login(page);

    // Step 2 gate: with zero staged variants the dock locks the only
    // forward CTA and reports a draft session (workflow state machine).
    await page.goto(`${UPLOAD}/rooms`);
    const dock = page.locator("[data-workbench-dock]");
    await expect(dock).toBeVisible();
    await expect(
      dock.getByRole("button", { name: "Send to Brush Refinement" })
    ).toBeDisabled();
    await expect(dock.getByText("Draft", { exact: true })).toBeVisible();
    await expect(dock.getByRole("status")).toHaveText(/0 of 1 room staged/);

    // Step 4 gate: jumping straight to the report renders the route (200
    // + heading) but the showcase stays empty — no fabricated report
    // until Steps 2–3 actually produce staged pairs.
    const response = await page.goto(`${UPLOAD}/report`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "101 Upload Lane" })
    ).toBeVisible();
    await expect(
      page.getByText(
        "No staged room pairs yet — complete Steps 2 and 3 to populate the showcase."
      )
    ).toBeVisible();
  });
});
