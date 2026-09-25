import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Cache } from "@/lib/cache";

const T0 = new Date("2026-06-01T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms: number) {
  vi.setSystemTime(T0 + ms);
}

describe("Cache basics", () => {
  it("stores and retrieves a value", () => {
    const cache = new Cache<string, number>();
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("returns undefined for a missing key", () => {
    const cache = new Cache<string, number>();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts the oldest entry when maxSize is reached", () => {
    const cache = new Cache<string, number>({ maxSize: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("updates expiry time on repeated set", () => {
    const cache = new Cache<string, number>({ ttl: 100 });
    cache.set("a", 1);
    vi.advanceTimersByTime(50);
    cache.set("a", 2);
    vi.advanceTimersByTime(60);
    expect(cache.get("a")).toBe(2);
  });
});

describe("sweep", () => {
  it("returns 0 when maxAge is Infinity (default)", () => {
    const cache = new Cache<string, number>();
    cache.set("a", 1);
    expect(cache.sweep()).toBe(0);
    expect(cache.get("a")).toBe(1);
  });

  it("removes entries older than maxAge via explicit sweep", () => {
    const cache = new Cache<string, number>({ maxAge: Infinity });
    cache.set("a", 1);
    cache.set("b", 2);
    advance(200);
    const removed = cache.sweep(150);
    expect(removed).toBe(2);
    expect(cache.size()).toBe(0);
  });

  it("accepts a maxAgeMs override that differs from class maxAge", () => {
    const cache = new Cache<string, number>({ maxAge: Infinity });
    cache.set("a", 1);
    advance(300);
    const removed = cache.sweep(200);
    expect(removed).toBe(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("sweep is called on every set", () => {
    const cache = new Cache<string, number>({ maxAge: 100 });
    cache.set("a", 1);
    vi.advanceTimersByTime(50);
    cache.set("b", 2);
    vi.advanceTimersByTime(60);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("handles an empty cache gracefully", () => {
    const cache = new Cache<string, number>({ maxAge: 100 });
    expect(cache.sweep()).toBe(0);
  });

  it("removes all expired entries at once", () => {
    const cache = new Cache<string, number>({ maxAge: 50 });
    cache.set("a", 1);
    cache.set("b", 2);
    vi.advanceTimersByTime(100);
    expect(cache.sweep()).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});

describe("memory bound in serverless environment", () => {
  it("proactive sweep on set prevents unbounded growth from cold-start entries", () => {
    const cache = new Cache<string, number>({ maxAge: 100, maxSize: 1000 });
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(20);
      cache.set(`key-${i}`, i);
    }
    vi.advanceTimersByTime(150);
    cache.set("new-entry", 999);
    expect(cache.get("key-0")).toBeUndefined();
    expect(cache.get("key-1")).toBeUndefined();
    expect(cache.get("new-entry")).toBe(999);
  });
});
