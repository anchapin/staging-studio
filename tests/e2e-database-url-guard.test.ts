import { describe, it, expect } from "vitest";

import { assertEphemeralDatabaseUrl } from "./e2e/database-url-guard";
import { DATABASE_URL, POSTGRES_PORT } from "./e2e/env";

/**
 * Issue #1102 — pin the e2e DATABASE_URL shape guard.
 *
 * Background: the e2e suite is the one place the harness writes to a
 * database, via `pushSchema()` (spawns `npx prisma db push`) and `seed()`
 * (constructs its own `PrismaClient`). Both run with `DATABASE_URL` set
 * to the disposable loopback container, and the contract rests on the
 * Prisma CLI not overriding that value when it reads `.env` via
 * `prisma.config.ts`'s `import "dotenv/config"`. dotenv is documented to
 * leave existing `process.env` entries alone today, but that is one
 * Prisma major version away from changing silently — and on a dev
 * machine the `.env` symlink targets `.env.local`, which holds the real
 * Supabase connection string. A regression there is a
 * /schema push to production/ scenario with no observable failure.
 *
 * `assertEphemeralDatabaseUrl()` in `tests/e2e/database-url-guard.ts`
 * (called from `global-setup.ts`) rejects any URL whose shape doesn't
 * match the disposable container so the bug surfaces at the harness
 * level rather than as a misdirected write. These tests pin the
 * validator so a careless loosening trips the build.
 */
describe("assertEphemeralDatabaseUrl (issue #1102)", () => {
  it("accepts the harness's exported loopback URL", () => {
    expect(() => assertEphemeralDatabaseUrl(DATABASE_URL, POSTGRES_PORT)).not.toThrow();
  });

  it("accepts an equivalent localhost URL", () => {
    const url = `postgresql://e2e:e2e@localhost:${POSTGRES_PORT}/staging_studio_e2e`;
    expect(() => assertEphemeralDatabaseUrl(url, POSTGRES_PORT)).not.toThrow();
  });

  it("accepts the legacy postgres:// alias protocol", () => {
    const url = `postgres://e2e:e2e@127.0.0.1:${POSTGRES_PORT}/staging_studio_e2e`;
    expect(() => assertEphemeralDatabaseUrl(url, POSTGRES_PORT)).not.toThrow();
  });

  it("accepts any username and database name that contain 'e2e'", () => {
    const url = `postgresql://my_e2e_user:s3cret@127.0.0.1:${POSTGRES_PORT}/my_e2e_db`;
    expect(() => assertEphemeralDatabaseUrl(url, POSTGRES_PORT)).not.toThrow();
  });

  it("throws on undefined / empty input", () => {
    expect(() => assertEphemeralDatabaseUrl(undefined, POSTGRES_PORT)).toThrow(/unset/);
    expect(() => assertEphemeralDatabaseUrl("", POSTGRES_PORT)).toThrow(/unset/);
  });

  it("throws on a non-URL string", () => {
    expect(() => assertEphemeralDatabaseUrl("not a url at all", POSTGRES_PORT)).toThrow(
      /not a valid URL/
    );
  });

  it("throws on a non-postgres protocol (e.g. mysql://)", () => {
    const url = `mysql://e2e:e2e@127.0.0.1:${POSTGRES_PORT}/e2e`;
    expect(() => assertEphemeralDatabaseUrl(url, POSTGRES_PORT)).toThrow(/postgresql/);
  });

  it("throws when the host is not a loopback address (the production-regression case)", () => {
    // This is the catastrophic shape: a real Supabase host that somehow
    // made it past process.env. The guard must refuse it loudly.
    const url = `postgresql://postgres:secret@db.supabase.co:5432/postgres`;
    expect(() => assertEphemeralDatabaseUrl(url, POSTGRES_PORT)).toThrow(/loopback/);
  });

  it("throws when the port is not the harness's POSTGRES_PORT", () => {
    const url = `postgresql://e2e:e2e@127.0.0.1:5432/staging_studio_e2e`;
    expect(() => assertEphemeralDatabaseUrl(url, POSTGRES_PORT)).toThrow(
      new RegExp(String(POSTGRES_PORT))
    );
  });

  it("throws when the username does not contain 'e2e'", () => {
    const url = `postgresql://postgres:e2e@127.0.0.1:${POSTGRES_PORT}/staging_studio_e2e`;
    expect(() => assertEphemeralDatabaseUrl(url, POSTGRES_PORT)).toThrow(/username/);
  });

  it("throws when the database name does not contain 'e2e'", () => {
    const url = `postgresql://e2e:e2e@127.0.0.1:${POSTGRES_PORT}/staging_studio`;
    expect(() => assertEphemeralDatabaseUrl(url, POSTGRES_PORT)).toThrow(/database/);
  });
});