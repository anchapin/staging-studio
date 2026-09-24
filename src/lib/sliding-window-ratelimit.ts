interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface SlidingWindowEntry {
  timestamp: number;
}

const store = new Map<string, SlidingWindowEntry[]>();

export function checkRateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  const entries = store.get(identifier) ?? [];

  const validEntries = entries.filter((e) => e.timestamp > windowStart);

  if (validEntries.length < limit) {
    validEntries.push({ timestamp: now });
    store.set(identifier, validEntries);

    return {
      allowed: true,
      remaining: limit - validEntries.length,
      resetAt: now + windowMs,
    };
  }

  const oldestTimestamp = validEntries[0].timestamp;
  const resetAt = oldestTimestamp + windowMs;

  return {
    allowed: false,
    remaining: 0,
    resetAt,
  };
}

export function clearRateLimit(identifier: string): void {
  store.delete(identifier);
}
