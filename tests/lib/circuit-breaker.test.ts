import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CircuitState,
  CircuitBreaker,
  CircuitBreakerOpenError,
  getCircuitBreaker,
  resetAllCircuitBreakers,
} from "@/lib/circuit-breaker";

/**
 * In-memory stand-in for the Postgres sliding-window store
 * (`@/lib/sliding-window-ratelimit`). Mirrors its contract: check is
 * read-only, record appends, clear deletes, denial resetAt is the moment
 * the oldest valid entry leaves the window. `failNext` simulates a store
 * outage so the breaker's fail-open behavior can be pinned.
 */
const store = {
  rows: new Map<string, Date[]>(),
  failNext: false,
  reset() {
    this.rows.clear();
    this.failNext = false;
  },
};

vi.mock("@/lib/sliding-window-ratelimit", () => {
  const checkRateLimit = vi.fn(async (id: string, limit: number, windowMs: number) => {
    if (store.failNext) throw new Error("store down");
    const now = Date.now();
    const entries = (store.rows.get(id) ?? []).filter(
      (ts) => now - ts.getTime() < windowMs
    );
    store.rows.set(id, entries);
    const allowed = entries.length < limit;
    return {
      allowed,
      remaining: Math.max(0, limit - entries.length - (allowed ? 1 : 0)),
      resetAt: allowed
        ? now + windowMs
        : (entries[0]?.getTime() ?? now) + windowMs,
    };
  });
  const recordRateLimit = vi.fn(async (id: string, limit: number, windowMs: number) => {
    if (store.failNext) throw new Error("store down");
    const now = Date.now();
    const entries = (store.rows.get(id) ?? []).filter(
      (ts) => now - ts.getTime() < windowMs
    );
    if (entries.length + 1 > limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: (entries[0]?.getTime() ?? now) + windowMs,
      };
    }
    entries.push(new Date(now));
    store.rows.set(id, entries);
    return { allowed: true, remaining: limit - entries.length, resetAt: now + windowMs };
  });
  const checkAndRecordRateLimit = vi.fn(async (id: string, limit: number, windowMs: number) => {
    const check = await checkRateLimit(id, limit, windowMs);
    if (!check.allowed) return check;
    return recordRateLimit(id, limit, windowMs);
  });
  const clearRateLimit = vi.fn(async (id: string) => {
    if (store.failNext) throw new Error("store down");
    store.rows.delete(id);
  });
  return { checkRateLimit, recordRateLimit, checkAndRecordRateLimit, clearRateLimit };
});

describe("CircuitBreaker (Postgres-backed, issue #1123)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    store.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAllCircuitBreakers();
  });

  describe("CircuitState enum", () => {
    it("has CLOSED and OPEN values (HALF_OPEN removed: recovery is implicit)", () => {
      expect(CircuitState.CLOSED).toBe("CLOSED");
      expect(CircuitState.OPEN).toBe("OPEN");
      expect(Object.keys(CircuitState)).toEqual(["CLOSED", "OPEN"]);
    });
  });

  describe("CircuitBreakerOpenError", () => {
    it("creates error with service name", () => {
      const error = new CircuitBreakerOpenError("test-service");
      expect(error.service).toBe("test-service");
      expect(error.circuitState).toBe(CircuitState.OPEN);
      expect(error.retryAfterMs).toBeNull();
      expect(error.message).toBe('Circuit breaker is open for "test-service"');
      expect(error.name).toBe("CircuitBreakerOpenError");
      expect(error).toBeInstanceOf(Error);
    });

    it("creates error with custom retryAfterMs", () => {
      const error = new CircuitBreakerOpenError("test-service", 5000);
      expect(error.retryAfterMs).toBe(5000);
    });
  });

  it("executes the call while under the failure threshold", async () => {
    const cb = new CircuitBreaker("svc", { failureThreshold: 3 });
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(cb.execute(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("opens after failureThreshold failures and throws CircuitBreakerOpenError on the next call", async () => {
    const cb = new CircuitBreaker("svc", { failureThreshold: 3 });
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    // The tripping call surfaces the ORIGINAL error, not the breaker's.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1_000);
      await expect(cb.execute(fn)).rejects.toThrow("fail");
    }

    vi.advanceTimersByTime(1_000);
    let caught: unknown;
    await cb.execute(fn).catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(CircuitBreakerOpenError);
    expect((caught as CircuitBreakerOpenError).service).toBe("svc");
    expect((caught as CircuitBreakerOpenError).retryAfterMs).toBeGreaterThan(0);
    // The guarded call never reaches the provider.
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retryAfterMs counts down to the oldest failure leaving the window", async () => {
    const cb = new CircuitBreaker("svc", { failureThreshold: 2, cooldownMs: 30_000 });
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    vi.advanceTimersByTime(1_000);
    await expect(cb.execute(fn)).rejects.toThrow("fail");
    vi.advanceTimersByTime(2_000);
    await expect(cb.execute(fn)).rejects.toThrow("fail");
    // Oldest failure at t=1000, window 30s; the third attempt is at t=4000,
    // so the oldest entry leaves the window at t=31000 (27s from now).
    vi.advanceTimersByTime(1_000);
    let caught: unknown;
    await cb.execute(fn).catch((e) => {
      caught = e;
    });
    expect((caught as CircuitBreakerOpenError).retryAfterMs).toBe(27_000);
  });

  it("success clears recorded failures", async () => {
    const cb = new CircuitBreaker("svc", { failureThreshold: 3 });
    const fail = vi.fn().mockRejectedValue(new Error("fail"));
    const ok = vi.fn().mockResolvedValue("ok");

    await expect(cb.execute(fail)).rejects.toThrow("fail");
    await expect(cb.execute(fail)).rejects.toThrow("fail");
    await cb.execute(ok);

    await expect(cb.execute(fail)).rejects.toThrow("fail");
    await expect(cb.execute(fail)).rejects.toThrow("fail");
    // Two failures since the clear: still under threshold.
    await expect(cb.execute(ok)).resolves.toBe("ok");
  });

  it("closes again once failures slide out of the cooldown window", async () => {
    const cb = new CircuitBreaker("svc", { failureThreshold: 2, cooldownMs: 30_000 });
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(cb.execute(fn)).rejects.toThrow("fail");
    vi.advanceTimersByTime(1_000);
    await expect(cb.execute(fn)).rejects.toThrow("fail");

    vi.advanceTimersByTime(31_000);
    await expect(cb.execute(fn)).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("fails OPEN when the breaker store is unreachable", async () => {
    const cb = new CircuitBreaker("svc");
    const fn = vi.fn().mockResolvedValue("ok");
    store.failNext = true;
    await expect(cb.execute(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a store outage during the failure record does not mask the original error", async () => {
    const cb = new CircuitBreaker("svc");
    store.rows.set("circuit-breaker:svc", []); // check succeeds, then...
    const fn = vi.fn().mockRejectedValue(new Error("provider exploded"));

    await expect(cb.execute(fn)).rejects.toThrow("provider exploded");
  });

  it("getCircuitBreaker returns the same handle per service", () => {
    const a = getCircuitBreaker("fal.ai", { failureThreshold: 3 });
    const b = getCircuitBreaker("fal.ai");
    expect(a).toBe(b);
    expect(getCircuitBreaker("browserless")).not.toBe(a);
  });
});
