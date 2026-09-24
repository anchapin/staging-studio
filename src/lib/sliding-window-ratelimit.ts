/**
 * Sliding-window rate limiter backed by Postgres.
 *
 * Replaces the in-memory Map that failed in serverless environments where
 * multiple instances share no state (issue #832).
 *
 * Algorithm: for each request, we store an entry with windowStart (Unix ms)
 * and a count. The sliding window is implemented by:
 * 1. Finding the current window start based on windowMs
 * 2. Cleaning up expired entries periodically
 * 3. Incrementing count for existing window or creating new entry
 */

import { prisma } from "@/lib/prisma";

// Cleanup threshold: clean up entries older than this many window periods
const CLEANUP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetsAt: Date;
}

/**
 * Check and increment the rate limit for a given identifier.
 *
 * @param identifier - Unique identifier (e.g. user ID or IP)
 * @param limit - Maximum requests allowed in the window
 * @param windowMs - Window size in milliseconds
 * @param now - Current timestamp (injectable for testing)
 * @returns RateLimitResult with allowed flag and metadata
 */
export async function slidingWindowRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
  now: Date = new Date()
): Promise<RateLimitResult> {
  const windowStart = BigInt(Math.floor(now.getTime() / windowMs) * windowMs);
  const windowEndMs = Number(windowStart) + windowMs;

  // Cleanup expired entries (with jitter to avoid thundering herd)
  const cleanupThreshold = new Date(now.getTime() - CLEANUP_THRESHOLD_MS);
  await prisma.rateLimitEntry.deleteMany({
    where: {
      expiresAt: {
        lt: cleanupThreshold,
      },
    },
  });

  // Find existing entry for this identifier and window
  const existing = await prisma.rateLimitEntry.findFirst({
    where: {
      identifier,
      windowStart,
    },
  });

  if (existing) {
    // Within window: increment count
    const newCount = existing.count + 1;
    const allowed = newCount <= limit;

    if (allowed) {
      await prisma.rateLimitEntry.update({
        where: { id: existing.id },
        data: { count: newCount },
      });
    }

    return {
      allowed,
      remaining: Math.max(0, limit - newCount),
      limit,
      resetsAt: new Date(windowEndMs),
    };
  } else {
    // New window: create entry
    await prisma.rateLimitEntry.create({
      data: {
        identifier,
        windowStart,
        count: 1,
        expiresAt: new Date(windowEndMs + CLEANUP_THRESHOLD_MS),
      },
    });

    return {
      allowed: true,
      remaining: limit - 1,
      limit,
      resetsAt: new Date(windowEndMs),
    };
  }
}

/**
 * Get the current count for an identifier without incrementing.
 * Useful for preflight checks.
 */
export async function getCurrentCount(
  identifier: string,
  windowMs: number,
  now: Date = new Date()
): Promise<number> {
  const windowStart = BigInt(Math.floor(now.getTime() / windowMs) * windowMs);

  const entry = await prisma.rateLimitEntry.findFirst({
    where: {
      identifier,
      windowStart,
    },
  });

  return entry?.count ?? 0;
}
