import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  checkRateLimit,
  cleanupExpiredEntries,
  clearRateLimitStore,
  getClientIp,
} from "@/lib/rate-limit";

/**
 * Issue #1061: in-memory rate limiter.
 *
 * Per-IP sliding-window counter with the `allowed / remaining / resetIn`
 * return shape consumed by every rate-limited API surface. Defaults are
 * 5 requests / 10 minutes — what we pin here.
 */

describe("checkRateLimit (issue #1061)", () => {
  // Use vitest fake timers so the window-reset test is deterministic
  // and instant. The module reads Date.now() internally — vi.useFakeTimers
  // stubs that globally for the test.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first request from a fresh IP", () => {
    const result = checkRateLimit("10.0.0.1:1", 5, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.resetIn).toBe(60_000);
  });

  it("decrements `remaining` on every allowed request until the limit", () => {
    const ip = "10.0.0.2:1";
    const r1 = checkRateLimit(ip, 5, 60_000);
    const r2 = checkRateLimit(ip, 5, 60_000);
    const r3 = checkRateLimit(ip, 5, 60_000);
    expect(r1.remaining).toBe(4);
    expect(r2.remaining).toBe(3);
    expect(r3.remaining).toBe(2);
  });

  it("blocks the request that exceeds the limit and reports resetIn", () => {
    const ip = "10.0.0.3:1";
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit(ip, 5, 60_000);
      expect(r.allowed).toBe(true);
    }
    const sixth = checkRateLimit(ip, 5, 60_000);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
    expect(sixth.resetIn).toBeGreaterThan(0);
    expect(sixth.resetIn).toBeLessThanOrEqual(60_000);
  });

  it("resets the window once it has fully elapsed (advances Date.now)", () => {
    const ip = "10.0.0.4:1";
    for (let i = 0; i < 5; i++) checkRateLimit(ip, 5, 60);
    expect(checkRateLimit(ip, 5, 60).allowed).toBe(false);
    // Advance the synthetic clock past the window — no real wait.
    vi.advanceTimersByTime(70);
    const after = checkRateLimit(ip, 5, 60);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(4);
  });

  it("isolates per-IP counters", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("10.0.0.5:1", 5, 60_000);
    // Different IP — first request allowed, not blocked.
    const other = checkRateLimit("10.0.0.5:2", 5, 60_000);
    expect(other.allowed).toBe(true);
    expect(other.remaining).toBe(4);
  });

  it("respects a custom maxRequests argument", () => {
    const r = checkRateLimit("10.0.0.6:1", 2, 60_000);
    expect(r.remaining).toBe(1);
    checkRateLimit("10.0.0.6:1", 2, 60_000);
    expect(checkRateLimit("10.0.0.6:1", 2, 60_000).allowed).toBe(false);
  });
});

describe("getClientIp (issue #1061)", () => {
  function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request("https://example.com/api/x", { headers });
  }

  it("returns the first value in x-forwarded-for when present", () => {
    const req = makeRequest({
      "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2",
    });
    expect(getClientIp(req)).toBe("203.0.113.5");
  });

  it("trims surrounding whitespace from x-forwarded-for", () => {
    const req = makeRequest({ "x-forwarded-for": "  203.0.113.5  " });
    expect(getClientIp(req)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = makeRequest({ "x-real-ip": "198.51.100.7" });
    expect(getClientIp(req)).toBe("198.51.100.7");
  });

  it("prefers x-forwarded-for over x-real-ip when both are present", () => {
    const req = makeRequest({
      "x-forwarded-for": "203.0.113.5",
      "x-real-ip": "198.51.100.7",
    });
    expect(getClientIp(req)).toBe("203.0.113.5");
  });

  it("falls back to 127.0.0.1 when neither proxy header is present", () => {
    expect(getClientIp(makeRequest())).toBe("127.0.0.1");
  });
});

describe("cleanupExpiredEntries (issue #1061, regression guard for #1122)", () => {
  // -------------------------------------------------------------------------
  // Shared setup — each test gets a pristine clock and store.
  // -------------------------------------------------------------------------
  const FIXED_IP = "10.0.0.99";
  // Use a 30-min window for checkRateLimit — deliberately longer than
  // cleanupExpiredEntries's internal 20-min eviction threshold so that:
  //   • At T0+15m: entry is still in-window (15 < 30) → count increments.
  //   • At T0+25m: entry is still in-window (25 < 30) → but cleanup evicts.
  // This makes the difference between "survived cleanup" and "evicted"
  // observable via remaining (and resetIn).
  const WINDOW_MS = 30 * 60 * 1000; // 30 min

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    clearRateLimitStore(); // Ensure test isolation for the in-memory store.
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Helper: insert a single request at the current clock position.
  // -------------------------------------------------------------------------
  function seedEntry(): void {
    checkRateLimit(FIXED_IP, 5, WINDOW_MS);
  }

  // -------------------------------------------------------------------------
  // TEST 1 — entry aged 15 min (< 20 min threshold) must SURVIVE cleanup.
  //
  // After 15 min + cleanup:
  //   • cleanupExpiredEntries does NOT evict (15 < 20).
  //   • checkRateLimit with 30-min window: entry still in-window.
  //   • Entry count increments: 1 → 2.
  //   • remaining = 5 - 2 = 3, resetIn = 30 - 15 = 15 min.
  //
  // If the buggy "windowMs * 0.5" predicate were active, the entry would
  // be wrongly removed at T0+15m (since 15 >= 5).  Then checkRateLimit
  // would create a fresh entry: count = 1, remaining = 4, resetIn = 30 min.
  //
  // This test asserts remaining = 3 (entry survived) — it FAILS under ×0.5.
  // -------------------------------------------------------------------------
  it("survives cleanup when 15 minutes old (below 2× window threshold)", () => {
    seedEntry(); // T0
    vi.advanceTimersByTime(15 * 60 * 1000); // T0+15m
    cleanupExpiredEntries();
    const result = checkRateLimit(FIXED_IP, 5, WINDOW_MS);
    // Entry survived cleanup → count was incremented → remaining = 3.
    // With buggy ×0.5: entry wrongly removed → fresh entry → remaining = 4.
    expect(result.remaining).toBe(3);
    expect(result.resetIn).toBe(15 * 60 * 1000); // 900_000
  });

  // -------------------------------------------------------------------------
  // TEST 2 — entry aged 25 min (≥ 20 min threshold) must be EVICTED.
  //
  // After 25 min + cleanup:
  //   • cleanupExpiredEntries evicts (25 >= 20).
  //   • checkRateLimit sees no entry → new window with count = 1.
  //   • remaining = 5 - 1 = 4, resetIn = 30 min.
  // -------------------------------------------------------------------------
  it("evicts entries 25 minutes old (above 2× window threshold)", () => {
    seedEntry(); // T0
    vi.advanceTimersByTime(25 * 60 * 1000); // T0+25m
    cleanupExpiredEntries();
    const result = checkRateLimit(FIXED_IP, 5, WINDOW_MS);
    // Entry was evicted → fresh window → remaining = 4, full resetIn.
    expect(result.remaining).toBe(4);
    expect(result.resetIn).toBe(WINDOW_MS); // 30 min
  });

  // -------------------------------------------------------------------------
  // TEST 3 — entry aged 5 min (well within 20 min threshold) must survive.
  //
  // This catches the "inverted comparison" regression: if the predicate
  // were `now - entry.windowStart < windowMs * 2` (inverted), the entry
  // would be removed at T0+5m (condition true for removal instead of false).
  //
  // After 5 min + cleanup:
  //   • Entry is NOT evicted (5 < 20).
  //   • checkRateLimit: entry still in-window, count increments to 2.
  //   • remaining = 3, resetIn = 30 - 5 = 25 min.
  // -------------------------------------------------------------------------
  it("does not evict entries within the live window (catches inverted comparison)", () => {
    seedEntry(); // T0
    vi.advanceTimersByTime(5 * 60 * 1000); // T0+5m — inside 20-min horizon
    cleanupExpiredEntries();
    const result = checkRateLimit(FIXED_IP, 5, WINDOW_MS);
    // Entry survived → count incremented → remaining = 3.
    expect(result.remaining).toBe(3);
    expect(result.resetIn).toBe(25 * 60 * 1000); // 25 min
  });

  // -------------------------------------------------------------------------
  // TEST 4 — verify cleanupExpiredEntries returns undefined (void function).
  // -------------------------------------------------------------------------
  it("returns undefined", () => {
    expect(cleanupExpiredEntries()).toBeUndefined();
  });
});