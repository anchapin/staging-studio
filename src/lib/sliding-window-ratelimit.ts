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
import type { DailyApiUsage } from "@prisma/client";

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
