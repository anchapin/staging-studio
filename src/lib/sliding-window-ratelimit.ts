/**
 * Sliding-window rate limiter backed by Postgres (DailyApiUsage table).
 * Replaces the in-memory Map implementation that was incompatible with
 * serverless environments (issue #937).
 *
 * Uses upsert operations with @@unique([userId, surface, dayKey]) for atomic
 * concurrent access. Sliding window is maintained via a DateTime[] array
 * on each record, pruned on each check/record call.
 */

import { prisma } from "@/lib/prisma";
import type { DailyApiUsage, Prisma } from "@prisma/client";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

function parseIdentifier(identifier: string): { surface: string; userId: string } {
  const parts = identifier.split(":");
  return {
    surface: parts.length > 1 ? parts[0] : "default",
    userId: parts.length > 1 ? parts[1] : identifier,
  };
}

export function dayKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  return [
    String(year).padStart(4, "0"),
    String(month + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function windowEnd(now: Date = new Date()): Date {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  return new Date(year, month, day + 1, 0, 0, 0, 0);
}

async function fetchAndCleanTimestamps(
  record: DailyApiUsage,
  limit: number,
  windowMs: number,
  now: Date = new Date()
): Promise<{ validTimestamps: Date[]; allowed: boolean; remaining: number }> {
  const cutoff = new Date(now.getTime() - windowMs);
  const validTimestamps = record.timestamps
    .filter((ts) => ts >= cutoff)
    .sort((a, b) => a.getTime() - b.getTime());

  const count = validTimestamps.length;
  const allowed = count < limit;
  const remaining = Math.max(0, limit - count);

  return { validTimestamps, allowed, remaining };
}

export async function checkRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
  now: Date = new Date()
): Promise<RateLimitResult> {
  const { surface, userId } = parseIdentifier(identifier);
  const dk = dayKey(now);
  const we = windowEnd(now);

  const record = await prisma.dailyApiUsage.findUnique({
    where: { userId_surface_dayKey: { userId, surface, dayKey: dk } },
  });

  if (!record) {
    return { allowed: true, remaining: limit - 1, resetAt: we.getTime() };
  }

  const { validTimestamps, allowed, remaining } = await fetchAndCleanTimestamps(
    record,
    limit,
    windowMs,
    now
  );

  if (validTimestamps.length === 0 && record.count > 0) {
    await prisma.dailyApiUsage.update({
      where: { userId_surface_dayKey: { userId, surface, dayKey: dk } },
      data: { timestamps: [], count: 0 },
    });
    return { allowed: true, remaining: limit, resetAt: we.getTime() };
  }

  // Issue #1123: on a denial the constraint relaxes when the OLDEST valid
  // entry slides out of the window, so resetAt must be that moment, not
  // end-of-day (we). Callers surface resetAt as Retry-After on a 429.
  const resetAtMs =
    allowed || validTimestamps.length === 0
      ? we.getTime()
      : validTimestamps[0].getTime() + windowMs;

  return {
    allowed,
    remaining: Math.min(remaining, limit - validTimestamps.length),
    resetAt: resetAtMs,
  };
}

export async function recordRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
  now: Date = new Date()
): Promise<RateLimitResult> {
  const { surface, userId } = parseIdentifier(identifier);
  const dk = dayKey(now);
  const we = windowEnd(now);

  const existing = await prisma.dailyApiUsage.findUnique({
    where: { userId_surface_dayKey: { userId, surface, dayKey: dk } },
  });

  if (!existing) {
    await prisma.dailyApiUsage.create({
      data: {
        userId,
        surface,
        dayKey: dk,
        count: 1,
        timestamps: [now],
      },
    });
    return { allowed: true, remaining: limit - 1, resetAt: we.getTime() };
  }

  const cutoff = new Date(now.getTime() - windowMs);
  const validTimestamps = existing.timestamps
    .filter((ts) => ts >= cutoff)
    .sort((a, b) => a.getTime() - b.getTime());

  const newCount = validTimestamps.length + 1;
  const allowed = newCount <= limit;

  if (!allowed) {
    const resetAtMs =
      validTimestamps.length > 0
        ? validTimestamps[0].getTime() + windowMs
        : we.getTime();
    return { allowed: false, remaining: 0, resetAt: resetAtMs };
  }

  // Write back the PRUNED array (not just the append) so stale entries
  // leave the row instead of accumulating for the rest of the day (#1123).
  const newTimestamps = [...validTimestamps, now];

  await prisma.dailyApiUsage.update({
    where: { userId_surface_dayKey: { userId, surface, dayKey: dk } },
    data: {
      count: newCount,
      timestamps: newTimestamps,
    },
  });

  return {
    allowed: true,
    remaining: Math.max(0, limit - newCount),
    resetAt: we.getTime(),
  };
}

/**
 * Atomically claim one unit of quota for `identifier`, or report the limit hit.
 *
 * `recordRateLimit` above is a read-modify-write across two round trips, so two
 * concurrent callers can both read the same `timestamps`, both decide they are
 * under the limit, and both write back their own array — one of the two writes
 * silently clobbers the other and the caller is granted a unit that is never
 * recorded. That overshoot is exactly what the daily caps document as known
 * (#1111, #1132). This variant closes it by serialising the read-decide-write
 * against the row, matching the transaction pattern already used by
 * `setup-rate-limit.ts` for the IP limiter.
 *
 * Prisma cannot express "fewer than `limit` entries still inside the window" as
 * a `where` predicate — `timestamps` is a plain `DateTime[]` and Prisma 7 has
 * no array-length or per-element range filter for it — so the limit cannot be
 * pushed down into a single conditional `updateMany`. The row lock is what
 * makes the decision atomic instead: the `FOR UPDATE` makes a second claim on
 * the same `(userId, surface, dayKey)` block until the first commits, so it
 * re-reads the already-incremented row and sees the winner's unit.
 *
 * The lock is scoped to one row, so claims for different users or different
 * surfaces never block each other.
 */
export async function claimRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const { surface, userId } = parseIdentifier(identifier);
  const dk = dayKey(now);
  const cutoff = new Date(now.getTime() - windowMs);
  const we = windowEnd(now).getTime();

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Materialise the row first so there is always a row to lock. A brand-new
    // row starts at count 0, which is by definition under any limit.
    await tx.dailyApiUsage.upsert({
      where: { userId_surface_dayKey: { userId, surface, dayKey: dk } },
      create: { userId, surface, dayKey: dk, count: 0, timestamps: [] },
      update: {},
    });

    // Serialise every other claim on this exact row for the rest of the tx.
    // Prisma has no first-class row-lock operator, so this goes through raw
    // SQL against the same table/columns the generated client uses.
    await tx.$queryRaw`
      SELECT "id" FROM "DailyApiUsage"
      WHERE "userId" = ${userId} AND "surface" = ${surface} AND "dayKey" = ${dk}
      FOR UPDATE
    `;

    const row = await tx.dailyApiUsage.findUnique({
      where: { userId_surface_dayKey: { userId, surface, dayKey: dk } },
    });
    const inWindow = (row?.timestamps ?? [])
      .filter((ts) => ts >= cutoff)
      .sort((a, b) => a.getTime() - b.getTime());

    if (inWindow.length >= limit) {
      // Over the limit: report the wait WITHOUT consuming a unit, and leave the
      // stored row untouched so a losing caller cannot inflate the counter.
      return {
        allowed: false,
        remaining: 0,
        resetAt: inWindow.length > 0 ? inWindow[0].getTime() + windowMs : we,
      };
    }

    // Under the limit: append this claim and persist the pruned live count, the
    // same post-condition `recordRateLimit` maintains.
    const next = [...inWindow, now];
    await tx.dailyApiUsage.update({
      where: { userId_surface_dayKey: { userId, surface, dayKey: dk } },
      data: { timestamps: next, count: next.length },
    });

    return {
      allowed: true,
      remaining: Math.max(0, limit - next.length),
      resetAt: we,
    };
  });
}

export async function clearRateLimit(identifier: string): Promise<void> {
  const { surface, userId } = parseIdentifier(identifier);
  const dk = dayKey();
  await prisma.dailyApiUsage.deleteMany({
    where: { userId, surface, dayKey: dk },
  });
}

export async function checkAndRecordRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
  now: Date = new Date()
): Promise<RateLimitResult> {
  const checkResult = await checkRateLimit(identifier, limit, windowMs, now);
  if (!checkResult.allowed) {
    return checkResult;
  }
  return recordRateLimit(identifier, limit, windowMs, now);
}
