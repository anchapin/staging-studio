import { defineConfig, devices } from "@playwright/test";

import { APP_PORT, APP_URL, nextEnv } from "./tests/e2e/env";

/**
 * Diagnostic Playwright config (issue #1344 follow-up): identical to
 * `playwright.config.ts` except `webServer.command` swaps the production
 * build for `npx next dev`, so React renders the unminified error
 * #441 stack trace and pinpoints the offending component.
 *
 * Usage: `npx playwright test --config=playwright.config.debug.ts tests/e2e/specs/upload.spec.ts`.
 *
 * Why opt-in (not the default): `next dev` is much slower than the
 * production build the e2e harness uses today (~10×), and the spec
 * suite's 90s per-test budget may be tight. The CI workflow doesn't
 * reference this file.
 */
export default defineConfig({
  testDir: "./tests/e2e/specs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "test-results",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  webServer: {
    // `next dev` so React renders unminified error #441 stacks — the
    // production build minifies and the spec only sees
    // "Minified React error #441; visit https://react.dev/errors/441".
    command: `npx next dev -p ${APP_PORT} -H 127.0.0.1`,
    url: `${APP_URL}/login`,
    timeout: 420_000,
    reuseExistingServer: !process.env.CI,
    env: nextEnv(),
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
