import { spawnSync } from "node:child_process";

import { POSTGRES_CONTAINER_NAME } from "./env";

/**
 * Playwright global teardown (issue #165).
 *
 * Stops the mock Supabase server (started in global-setup, same runner
 * process) and removes the disposable Postgres container so every run
 * starts from a clean slate. Failures here never mask test results —
 * each step is best-effort.
 */
async function main(): Promise<void> {
  const mock = globalThis.__e2eMockSupabase;
  if (mock) {
    await mock.stop();
    globalThis.__e2eMockSupabase = undefined;
  }
  spawnSync("docker", ["rm", "-f", POSTGRES_CONTAINER_NAME], { stdio: "pipe" });
}

export default main;
