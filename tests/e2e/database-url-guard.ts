/**
 * Issue #1102 — DATABASE_URL shape guard for the e2e harness.
 *
 * `pushSchema()` in `global-setup.ts` shells out to `npx prisma db push`
 * and `seed()` constructs its own `PrismaClient` — the only two places
 * the harness writes to a database. Both run with `DATABASE_URL` set to
 * the disposable loopback container, and that hermeticity contract rests
 * on the Prisma CLI not overriding the spawn-env value when it reads
 * `.env` via `prisma.config.ts`'s `import "dotenv/config"`. dotenv is
 * documented to leave existing `process.env` entries alone today, but
 * that is one Prisma major version away from changing silently. On a dev
 * machine the `.env` symlink targets `.env.local`, which holds the real
 * Supabase connection string — so a regression there would push the
 * schema to, and seed rows into, production.
 *
 * This guard rejects any URL whose shape doesn't match the disposable
 * container so the bug surfaces at the harness level rather than as a
 * misdirected write. The shape we require mirrors `DATABASE_URL` exported
 * from `./env`:
 *
 *   postgresql://e2e:e2e@127.0.0.1:<POSTGRES_PORT>/staging_studio_e2e
 *
 * Lives in its own module so the pure-logic unit test
 * (`tests/e2e-database-url-guard.test.ts`) can pin the validator without
 * importing `global-setup.ts` and pulling in `mock-supabase`,
 * `mock-browserless`, the Prisma client, and the fixture loaders —
 * vitest config scopes the unit run to `tests/` and excludes
 * `tests/e2e/**`.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function assertEphemeralDatabaseUrl(
  url: string | undefined,
  expectedPort: number
): void {
  if (!url) {
    throw new Error(
      "[e2e] DATABASE_URL is unset; refusing to push schema or write seed rows (issue #1102)"
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `[e2e] DATABASE_URL is not a valid URL: ${JSON.stringify(url)} (issue #1102)`
    );
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(
      `[e2e] DATABASE_URL protocol must be postgresql://, got ${parsed.protocol} (issue #1102)`
    );
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `[e2e] DATABASE_URL host must be a loopback address, got ${JSON.stringify(parsed.hostname)} (issue #1102)`
    );
  }
  if (parsed.port !== String(expectedPort)) {
    throw new Error(
      `[e2e] DATABASE_URL port must be the harness's POSTGRES_PORT=${expectedPort}, got ${JSON.stringify(parsed.port)} (issue #1102)`
    );
  }
  if (!parsed.username.includes("e2e")) {
    throw new Error(
      `[e2e] DATABASE_URL username must contain "e2e", got ${JSON.stringify(parsed.username)} (issue #1102)`
    );
  }
  if (!parsed.pathname.includes("e2e")) {
    throw new Error(
      `[e2e] DATABASE_URL database name must contain "e2e", got ${JSON.stringify(parsed.pathname)} (issue #1102)`
    );
  }
}