import { defineConfig, devices } from "@playwright/test";

import { APP_PORT, APP_URL, nextEnv } from "./tests/e2e/env";

/**
 * Playwright configuration for the staging-flow browser-automation harness
 * (issue #165). Deliberately separate from vitest: vitest owns unit tests
 * in `tests/*.test.ts`; Playwright owns browser specs in
 * `tests/e2e/specs/*.spec.ts` (excluded from the vitest run).
 *
 * Hermeticity: `globalSetup` starts a disposable Dockerized Postgres,
 * pushes the Prisma schema, seeds fixed rows, and serves a local mock
 * Supabase (GoTrue auth + Storage). The `webServer` env points the Next.js
 * build + server at those locals; fal.ai / OpenAI / Browserless are never
 * contacted because every spec intercepts their API routes at the browser
 * network layer.
 */
export default defineConfig({
  testDir: "./tests/e2e/specs",
  // Reliability over parallelism — this suite doubles as the T10
  // rehearsal harness; deterministic single-worker runs beat speed.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 90_000,
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
    // Production build + start: no lazy-compile races, closest to what the
    // rehearsal runs against. Env feeds both the build (NEXT_PUBLIC_*
    // inlining) and the runtime.
    command: `npm run build && npx next start -p ${APP_PORT} -H 127.0.0.1`,
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
