/**
 * Prisma 7 configuration.
 *
 * Replaces the `datasource.url = env("DATABASE_URL")` line that used to
 * live in `prisma/schema.prisma` (Prisma 7 forbids it; see
 * https://pris.ly/d/config-datasource and
 * https://pris.ly/d/prisma7-client-config). The URL is now sourced here
 * for CLI commands that actually touch the database (`prisma db push`,
 * `prisma db studio`, `prisma migrate *`); at runtime, the PrismaClient
 * is constructed with a driver adapter (see `src/lib/prisma.ts` and
 * the e2e harness).
 *
 * Why not use the `env("DATABASE_URL")` helper? Per the Prisma 7 docs:
 * "Commands like `prisma generate` don't need a database URL, but will
 * still fail if `env()` throws an error when loading the config file."
 * Our CI runs `npm ci` (which triggers the `prisma generate` postinstall)
 * without `DATABASE_URL` set (that secret is only injected into
 * production / staging deploys), so we read `process.env.DATABASE_URL`
 * directly and fall back to an empty string. Commands that need the URL
 * (db push, db studio) will surface a clear connection-time error in
 * that environment, which is the same failure mode as Prisma 5's
 * lazy-validation.
 */
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
