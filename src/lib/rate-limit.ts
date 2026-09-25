/**
 * Simple in-memory rate limiter for Edge runtime.
 *
 * Uses IP-based tracking with a sliding window approach.
 * Note: In serverless/Edge environments, this state resets on each cold start.
 * For production with multiple instances, consider using Vercel's KV or Upstash.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Check if a request from the given IP should be rate limited.
 *
 * @param ip - The IP address to check
 * @param maxRequests - Maximum requests allowed per window (default: 5)
 * @param windowMs - Window size in milliseconds (default: 10 minutes)
 * @returns { allowed: boolean, remaining: number, resetIn: number }
 */
export function checkRateLimit(
  ip: string,
  maxRequests: number = 5,
  windowMs: number = 10 * 60 * 1000
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  // No existing entry - start new window
  if (!entry) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
  }

  // Check if window has expired
  if (now - entry.windowStart >= windowMs) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
  }

  // Within window - check count
  if (entry.count >= maxRequests) {
    const resetIn = windowMs - (now - entry.windowStart);
    return { allowed: false, remaining: 0, resetIn };
  }

  // Increment count
  entry.count++;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetIn: windowMs - (now - entry.windowStart),
  };
}

/**
 * Get the client IP from the request.
 * Handles various proxy headers.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Fallback for local development
  return "127.0.0.1";
}

/**
 * Clean up expired entries periodically to prevent memory leaks.
 * Call this sparingly - in production, rely on the sliding window expiration.
 */
export function cleanupExpiredEntries(): void {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes

  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart >= windowMs * 2) {
      rateLimitStore.delete(ip);
    }
  }
}
