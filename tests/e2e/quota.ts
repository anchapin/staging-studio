import { PrismaClient } from "@prisma/client";

import {
  DATABASE_URL,
  E2E_DAILY_EXPORT_LIMIT,
  E2E_DAILY_INPAINT_LIMIT,
  E2E_USER_ID,
} from "./env";

/**
 * Helpers for driving the Postgres-backed `DailyApiUsage` daily counters
 * that the routes' 429 branches read.
 *
 * Why this module exists: `lib/api-quota.ts` originally tracked the
 * `copy`/`export`/`segment`/`label` surfaces in an in-process `Map`, which
 * made the counter per-instance and lost on serverless cold start. Issue
 * #784 moved them onto the `DailyApiUsage` table (keyed
 * `@@unique([userId, surface, dayKey])`), and #1131 moved `inpaint` onto
 * it too (it had been a COUNT of `InpaintRequest` rows, which cascade-
 * delete with the room, so deleting a room refunded the cap). Every
 * surface is a counter row now. That matters here: because the counter is
 * a real row in the suite's disposable Postgres, a spec can set it
 * directly instead of trying to exhaust it through the API.
 *
 * The alternative — `DAILY_EXPORT_LIMIT: "0"` in `nextEnv()` — looks
 * simpler but is process-wide: it would 429 EVERY export spec in the run,
 * including `export-pdf.spec.ts`, which drives the real unversioned
 * handler. Seeding one row is scoped to one test.
 *
 * Scope discipline: `nextEnv()` deliberately leaves the daily limits unset
 * so each route's default applies, and every helper here mutates the
 * counter only inside a `with*UsageAtLimit` wrapper, which restores the
 * prior value in a `finally` — a leftover row at the limit would 429
 * later specs and read as a phantom regression.
 */

/** The `export` surface key, matching `QuotaSurface` in `lib/api-quota.ts`. */
const EXPORT_SURFACE = "export";
/** The `inpaint` surface key (#1131). */
const INPAINT_SURFACE = "inpaint";

/**
 * The current server-local calendar day as `YYYY-MM-DD`, matching
 * `dailyWindow()`'s `dayKey` in `lib/api-quota.ts` (local midnight →
 * next local midnight, wall clock of the process reading it).
 *
 * Duplicated rather than imported on purpose: the harness must not import
 * app source (`@/lib/*`), and no spec does. The route runs in the Next.js
 * process and this runs in the Playwright worker, but both are on the
 * same host with the same `TZ` (`webServer.env` merges `process.env`), so
 * they agree — the only divergence would be a test straddling local
 * midnight, which would surface as a 200 instead of a 429.
 */
export function dailyUsageDayKey(now: Date = new Date()): string {
  return [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Runs `fn` with the seeded user's `export` usage for today pinned at
 * {@link E2E_DAILY_EXPORT_LIMIT}, so the quota branch of
 * `/api/v1/export-pdf` rejects the request — then restores the exact
 * prior counter value.
 *
 * Uses the limit, not limit+1, on purpose: `evaluateDailyQuota` serves
 * while `used < limit` ("the limit-th call is still served"), so `used`
 * equal to the limit is the first blocked state. A blocked request never
 * reaches `recordDailyUsage`, so the counter does not move on its own —
 * the `finally` is what puts the suite back the way it found it.
 */
export async function withExportUsageAtLimit<T>(fn: () => Promise<T>): Promise<T> {
  return withUsageAtCount(EXPORT_SURFACE, E2E_DAILY_EXPORT_LIMIT, fn);
}

/**
 * Same contract as {@link withExportUsageAtLimit} for the `inpaint`
 * surface (#1131), used by `inpaint-quota-ledger.spec.ts` to reach the
 * 429 branch of `POST /api/inpaint`.
 */
export async function withInpaintUsageAtLimit<T>(fn: () => Promise<T>): Promise<T> {
  return withUsageAtCount(INPAINT_SURFACE, E2E_DAILY_INPAINT_LIMIT, fn);
}

/** Pins `surface` usage for today at `count`, then restores it exactly. */
export async function withUsageAtCount<T>(
  surface: string,
  count: number,
  fn: () => Promise<T>
): Promise<T> {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  const dayKey = dailyUsageDayKey();
  const key = { userId: E2E_USER_ID, surface, dayKey };
  let prior: { count: number } | null = null;
  let seeded = false;

  try {
    prior = await prisma.dailyApiUsage.findUnique({
      where: { userId_surface_dayKey: key },
      select: { count: true },
    });
    await prisma.dailyApiUsage.upsert({
      where: { userId_surface_dayKey: key },
      create: { ...key, count },
      update: { count },
    });
    seeded = true;
    return await fn();
  } finally {
    // Only undo what we wrote: if the seed never landed, leave the row
    // alone rather than deleting a counter we never owned.
    if (seeded) {
      if (prior) {
        await prisma.dailyApiUsage.update({
          where: { userId_surface_dayKey: key },
          data: { count: prior.count },
        });
      } else {
        await prisma.dailyApiUsage.deleteMany({ where: key });
      }
    }
    await prisma.$disconnect();
  }
}
