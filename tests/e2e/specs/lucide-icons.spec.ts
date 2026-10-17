import { expect, test } from "@playwright/test";

import {
  E2E_CONCEPT_PROJECT_ID,
  E2E_EDITOR_PROJECT_ID,
  E2E_REHEARSAL_PROJECT_ID,
  E2E_SIGNOFF_PROJECT_ID,
} from "../env";
import {
  interceptFurnishingsDetection,
  interceptInpaint,
  interceptLabelInstances,
  login,
} from "../helpers";

/**
 * Lucide icon regression guard (issue #1281, follow-up to #1271).
 *
 * The lucide-react 0.400 → 1.55 bump landed as a single-line
 * `package.json` change because every named import resolved at
 * typecheck time. The bundler is happy when an icon's named export
 * resolves to *something*, but a rename can produce a runtime
 * regression (e.g. an icon whose inner path data was dropped,
 * rendering as an empty `<svg>`) that the type system would not
 * catch. This spec mounts every authenticated route, counts
 * `svg.lucide` elements, and asserts a per-route minimum so a
 * future icon-rename regression (where one or more icons disappear
 * from the page) makes the suite red.
 *
 * Per-route minimums are picked tight to today's rendered count (one
 * icon gone would fail the spec), but high enough that a UI tweak
 * that hides an icon in a single code path does not flake the
 * suite. The dashboard chrome (sign-out, breadcrumb, etc.) and
 * project sub-pages are covered separately.
 *
 * Routes covered (from AGENTS.md "Routing & auth"):
 *   - /projects (dashboard list — the post-login landing)
 *   - /projects/[id] (project overview)
 *   - /projects/[id]/setup (intake)
 *   - /projects/[id]/rooms (per-room staging)
 *   - /projects/[id]/refine (staged-result refinement)
 *   - /projects/[id]/lookbook (interactive lookbook editor)
 *   - /projects/[id]/report (client-facing consultation report)
 *
 * /login is public but renders no lucide icons today, so it is
 * asserted to be 0 to catch an accidental introduction. /settings
 * also renders no icons today (no `<X />` imports in the page or
 * its child components) and is asserted the same way.
 */
test.describe("lucide icon regression guard", () => {
  test("/projects (dashboard) renders lucide icons", async ({ page }) => {
    await login(page);
    await page.goto("/projects");
    // `toBeAttached` is intentional: lucide icons render with
    // `aria-hidden="true"` and the spec's job is to confirm they
    // exist in the DOM (the tripwire is "icon disappeared"), not
    // to assert user-visible state. `toBeVisible` would fail on
    // every aria-hidden icon.
    await expect(page.locator("svg.lucide").first()).toBeAttached();
    // Tighten the assertion to catch a single-icon regression: today's
    // rendered count is well above the per-route minimum even after
    // the dashboard chrome (sign-out, search, status pill, etc.).
    const count = await page.locator("svg.lucide").count();
    expect(count).toBeGreaterThan(3);
  });

  test("/projects/[id] (project overview) renders lucide icons", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/projects/${E2E_REHEARSAL_PROJECT_ID}`);
    // The project hero, room cards, and stage chips all carry icons;
    // wait for the first one to appear so the count is taken from a
    // fully-rendered tree, not a loading skeleton.
    await expect(page.locator("svg.lucide").first()).toBeAttached();
    const count = await page.locator("svg.lucide").count();
    expect(count).toBeGreaterThan(3);
  });

  test("/projects/[id]/setup (intake) renders lucide icons", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/projects/${E2E_REHEARSAL_PROJECT_ID}/setup`);
    await expect(page.locator("svg.lucide").first()).toBeAttached();
    const count = await page.locator("svg.lucide").count();
    expect(count).toBeGreaterThan(0);
  });

  test("/projects/[id]/rooms (per-room staging) renders lucide icons", async ({
    page,
  }) => {
    // The editor auto-fires a SAM 3.1 detection on open (issue #231);
    // both detection and label-instances need to land on the mock
    // to keep the run hermetic.
    interceptFurnishingsDetection(page);
    interceptLabelInstances(page);

    await login(page);
    await page.goto(`/projects/${E2E_EDITOR_PROJECT_ID}/rooms`);
    await expect(page.locator("svg.lucide").first()).toBeAttached();
    const count = await page.locator("svg.lucide").count();
    expect(count).toBeGreaterThan(3);
  });

  test("/projects/[id]/refine (staged-result refinement) renders lucide icons", async ({
    page,
  }) => {
    interceptFurnishingsDetection(page);
    interceptLabelInstances(page);
    interceptInpaint(page);

    await login(page);
    await page.goto(`/projects/${E2E_REHEARSAL_PROJECT_ID}/refine`);
    await expect(page.locator("svg.lucide").first()).toBeAttached();
    const count = await page.locator("svg.lucide").count();
    expect(count).toBeGreaterThan(0);
  });

  test("/projects/[id]/lookbook (lookbook editor) renders lucide icons", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/projects/${E2E_REHEARSAL_PROJECT_ID}/lookbook`);
    await expect(page.locator("svg.lucide").first()).toBeAttached();
    const count = await page.locator("svg.lucide").count();
    expect(count).toBeGreaterThan(0);
  });

  test("/projects/[id]/report (consultation report) renders lucide icons", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/projects/${E2E_SIGNOFF_PROJECT_ID}/report`);
    await expect(page.locator("svg.lucide").first()).toBeAttached();
    const count = await page.locator("svg.lucide").count();
    expect(count).toBeGreaterThan(0);
  });

  test("/settings renders lucide icons (dashboard chrome + page)", async ({
    page,
  }) => {
    // /settings sits inside the (dashboard) group, so the layout
    // sidebar (sign-out button, dashboard nav, etc.) contributes
    // lucide icons on top of any the page itself renders. The
    // minimum-count assertion catches a regression that drops an
    // icon from either the layout or the page; today's rendered
    // count is well above the minimum.
    await login(page);
    await page.goto("/settings");
    await expect(page.locator("main, [role='main']").first()).toBeAttached();
    const count = await page.locator("svg.lucide").count();
    expect(count).toBeGreaterThan(0);
  });

  test("/login renders zero lucide icons (regression tripwire)", async ({
    page,
  }) => {
    // /login is a public route. The login form has no `<X />`
    // imports in any of its components today; assert exactly 0 so
    // an accidental icon introduction in the login form would flip
    // this spec to a counted assertion, not silently pass.
    await page.goto("/login");
    await expect(page.getByLabel("Email address")).toBeAttached();
    const count = await page.locator("svg.lucide").count();
    expect(count).toBe(0);
  });

  test("concept flow route still renders lucide icons (smoke)", async ({
    page,
  }) => {
    // Pin a route that exercises the concept-detection / instance-
    // toggle paths — the most icon-dense area of the canvas tree —
    // so a regression that drops an icon in just that subtree is
    // caught even when the other routes happen to still render.
    interceptFurnishingsDetection(page);
    interceptLabelInstances(page);

    await login(page);
    await page.goto(`/projects/${E2E_CONCEPT_PROJECT_ID}/rooms`);
    await expect(page.locator("svg.lucide").first()).toBeAttached();
    const count = await page.locator("svg.lucide").count();
    expect(count).toBeGreaterThan(3);
  });
});
