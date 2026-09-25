import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimit, clearRateLimit } from "@/lib/sliding-window-ratelimit";

describe("sliding-window-ratelimit", () => {
  beforeEach(async () => {
    await clearRateLimit("test");
    await clearRateLimit("other");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. allows first request with remaining = limit - 1", async () => {
    const now = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(new Date(now));

    const result = await checkRateLimit("test", 5, 60000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.resetAt).toBe(now + 60000);
  });

  it("2. allows requests under the limit", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    await checkRateLimit("test", 5, 60000);
    await checkRateLimit("test", 5, 60000);
    await checkRateLimit("test", 5, 60000);

    const result = await checkRateLimit("test", 5, 60000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1); // 5 - 3 = 2, then 5 - 4 = 1 after 4th call
  });

  it("3. blocks requests at/over the limit", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    // Make 5 allowed requests (limit = 5)
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit("test", 5, 60000);
      expect(r.allowed).toBe(true);
    }

    // 6th request must be blocked
    const result = await checkRateLimit("test", 5, 60000);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("4. remaining decrements correctly as requests are made", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const r1 = await checkRateLimit("test", 3, 60000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await checkRateLimit("test", 3, 60000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await checkRateLimit("test", 3, 60000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = await checkRateLimit("test", 3, 60000);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it("5. resetAt is correctly calculated (oldest timestamp + windowMs when rate limited)", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z").getTime();
    vi.setSystemTime(new Date(now));

    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      await checkRateLimit("test", 3, 60000);
    }

    const blocked = await checkRateLimit("test", 3, 60000);
    expect(blocked.allowed).toBe(false);
    // The oldest entry was at t=now, so resetAt = now + 60000
    expect(blocked.resetAt).toBe(now + 60000);
  });

  it("6. old entries outside the window are evicted on each call", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    // Fill up to limit
    await checkRateLimit("test", 3, 60000);
    await checkRateLimit("test", 3, 60000);
    await checkRateLimit("test", 3, 60000);

    // Advance time past the window
    vi.setSystemTime(new Date("2026-01-01T00:01:30Z")); // 90 seconds later

    // Old entries should be evicted, so this should be allowed again
    const result = await checkRateLimit("test", 3, 60000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("7. different identifiers have independent rate limits", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    // Exhaust limit on "test"
    for (let i = 0; i < 3; i++) {
      await checkRateLimit("test", 3, 60000);
    }

    // "other" should still be allowed
    const result = await checkRateLimit("other", 3, 60000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("8. clearRateLimit removes entries and subsequent requests are allowed again", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    // Exhaust limit
    for (let i = 0; i < 3; i++) {
      await checkRateLimit("test", 3, 60000);
    }

    // Verify blocked
    const blocked = await checkRateLimit("test", 3, 60000);
    expect(blocked.allowed).toBe(false);

    // Clear and retry
    await clearRateLimit("test");

    const result = await checkRateLimit("test", 3, 60000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });
});
