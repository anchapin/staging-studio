/**
 * Setup rate limiting via Postgres.
 *
 * Strategy: fixed window with per-IP locking.
 * - Window: 1 hour
 * - Max attempts per window: 10
 * - On success: row is deleted (reset)
 * - On failure: upsert increment within the window; lock if count exceeds limit
 *
 * IP addresses are SHA-256 hashed before storage so raw IPs are never persisted.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SETUP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour in ms
export const SETUP_RATE_LIMIT_MAX_ATTEMPTS = 10;

/** How long to lock an IP after exhausting all attempts (same as window). */
export const SETUP_LOCKOUT_MS = SETUP_RATE_LIMIT_WINDOW_MS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  /** True if the request is allowed through; false if limit is exceeded. */
  allowed: boolean;
  /** Remaining attempts in the current window (0 when blocked). */
  remaining: number;
  /** Unix ms timestamp when the rate-limit window resets. */
  resetAt: number;
  /** True when the IP is currently in a lockout period. */
  locked: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hash of a string, hex-encoded. Runs in Edge-compatible context. */
async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Extract the best-effort client IP from request headers.
 * Supports x-forwarded-for (first comma-separated value) and
 * x-real-ip headers. Returns "unknown" when no header is present.
 */
export function extractIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/** Hash an IP for storage. */
export async function hashIp(ip: string): Promise<string> {
  return sha256Hex(ip);
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Check and record a failed setup attempt for the given IP.
 *
 * Returns a `RateLimitResult` indicating whether the request is allowed.
 * Must be called BEFORE processing the password check so blocked IPs are
 * rejected without any credential evaluation.
 */
export async function recordFailedAttempt(
  ipHash: string
): Promise<RateLimitResult> {
  const now = new Date();
  const windowMs = SETUP_RATE_LIMIT_WINDOW_MS;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Upsert the rate-limit row for this IP.
    const row = await tx.setupRateLimit.upsert({
      where: { ipHash },
      create: {
        ipHash,
        attemptCount: 1,
        windowStart: now,
        lockedUntil: null,
      },
      update: {
        attemptCount: { increment: 1 },
      },
    });

    // Check if the window has expired — if so, this is the first attempt
    // in a new window and the count should be 1 (already set above).
    const windowAge = now.getTime() - row.windowStart.getTime();
    const inNewWindow = windowAge >= windowMs;

    if (inNewWindow) {
      // Window rolled over — reset the count to 1 for this fresh attempt.
      await tx.setupRateLimit.update({
        where: { ipHash },
        data: { attemptCount: 1, windowStart: now },
      });
      return {
        allowed: true,
        remaining: SETUP_RATE_LIMIT_MAX_ATTEMPTS - 1,
        resetAt: now.getTime() + windowMs,
        locked: false,
      };
    }

    // If lockedUntil is set and hasn't expired, keep blocking.
    if (row.lockedUntil && row.lockedUntil.getTime() > now.getTime()) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: row.lockedUntil.getTime(),
        locked: true,
      };
    }

    // Hard lockout once max attempts is reached within the window.
    const locked =
      !row.lockedUntil && row.attemptCount >= SETUP_RATE_LIMIT_MAX_ATTEMPTS;

    if (locked) {
      const lockUntil = new Date(now.getTime() + SETUP_LOCKOUT_MS);
      await tx.setupRateLimit.update({
        where: { ipHash },
        data: { lockedUntil: lockUntil },
      });
      return {
        allowed: false,
        remaining: 0,
        resetAt: lockUntil.getTime(),
        locked: true,
      };
    }

    const remaining = Math.max(
      SETUP_RATE_LIMIT_MAX_ATTEMPTS - row.attemptCount,
      0
    );
    const resetAt = row.windowStart.getTime() + windowMs;

    return { allowed: true, remaining, resetAt, locked: false };
  });
}

/**
 * Check whether a given IP hash is currently within its rate-limit window
 * WITHOUT recording an attempt. Used by callers that already recorded a failure.
 */
export async function checkRateLimit(
  ipHash: string
): Promise<RateLimitResult> {
  const now = new Date();
  const windowMs = SETUP_RATE_LIMIT_WINDOW_MS;

  const row = await prisma.setupRateLimit.findUnique({ where: { ipHash } });

  if (!row) {
    return {
      allowed: true,
      remaining: SETUP_RATE_LIMIT_MAX_ATTEMPTS,
      resetAt: now.getTime() + windowMs,
      locked: false,
    };
  }

  if (row.lockedUntil && row.lockedUntil.getTime() > now.getTime()) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: row.lockedUntil.getTime(),
      locked: true,
    };
  }

  // Window expired — treat as new.
  const windowAge = now.getTime() - row.windowStart.getTime();
  if (windowAge >= windowMs) {
    return {
      allowed: true,
      remaining: SETUP_RATE_LIMIT_MAX_ATTEMPTS,
      resetAt: now.getTime() + windowMs,
      locked: false,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(SETUP_RATE_LIMIT_MAX_ATTEMPTS - row.attemptCount, 0),
    resetAt: row.windowStart.getTime() + windowMs,
    locked: false,
  };
}

/**
 * Clear all rate-limit state for a given IP hash.
 * Called on a successful setup so the IP starts fresh.
 */
export async function clearRateLimit(ipHash: string): Promise<void> {
  await prisma.setupRateLimit.deleteMany({ where: { ipHash } });
}
