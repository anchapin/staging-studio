import { describe, it, expect, beforeEach, vi } from "vitest";
import { Cache } from "@/lib/cache";

describe("Cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe("basic operations", () => {
    it("stores and retrieves a value", () => {
      const cache = new Cache<string, number>();
      cache.set("key", 42);
      expect(cache.get("key")).toBe(42);
    });

    it("returns undefined for missing key", () => {
      const cache = new Cache<string, number>();
      expect(cache.get("missing")).toBeUndefined();
    });

    it("overwrites existing value", () => {
      const cache = new Cache<string, number>();
      cache.set("key", 1);
      cache.set("key", 2);
      expect(cache.get("key")).toBe(2);
    });

    it("has returns true for existing key", () => {
      const cache = new Cache<string, number>();
      cache.set("key", 1);
      expect(cache.has("key")).toBe(true);
    });

    it("has returns false for missing key", () => {
      const cache = new Cache<string, number>();
      expect(cache.has("missing")).toBe(false);
    });

    it("has returns false for expired key", () => {
      const cache = new Cache<string, number>({ ttl: 100 });
      cache.set("key", 1);
      vi.advanceTimersByTime(101);
      expect(cache.has("key")).toBe(false);
    });

    it("deletes a key", () => {
      const cache = new Cache<string, number>();
      cache.set("key", 1);
      expect(cache.delete("key")).toBe(true);
      expect(cache.get("key")).toBeUndefined();
    });

    it("delete returns false for missing key", () => {
      const cache = new Cache<string, number>();
      expect(cache.delete("missing")).toBe(false);
    });

    it("clears all entries", () => {
      const cache = new Cache<string, number>();
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBeUndefined();
    });

    it("returns correct size", () => {
      const cache = new Cache<string, number>();
      expect(cache.size()).toBe(0);
      cache.set("a", 1);
      expect(cache.size()).toBe(1);
      cache.set("b", 2);
      expect(cache.size()).toBe(2);
      cache.delete("a");
      expect(cache.size()).toBe(1);
    });
  });

  describe("TTL", () => {
    it("evicts expired entries on access", () => {
      const cache = new Cache<string, number>({ ttl: 100 });
      cache.set("key", 42);
      vi.advanceTimersByTime(101);
      expect(cache.get("key")).toBeUndefined();
    });

    it("does not evict entries within TTL", () => {
      const cache = new Cache<string, number>({ ttl: 100 });
      cache.set("key", 42);
      vi.advanceTimersByTime(50);
      expect(cache.get("key")).toBe(42);
    });

    it("entries never expire when ttl is Infinity (default)", () => {
      const cache = new Cache<string, number>();
      cache.set("key", 42);
      vi.advanceTimersByTime(1_000_000);
      expect(cache.get("key")).toBe(42);
    });

    it("refreshes expiration on re-access (LRU)", () => {
      const cache = new Cache<string, number>({ ttl: 100, maxSize: 2 });
      cache.set("a", 1);
      cache.set("b", 2);
      vi.advanceTimersByTime(50);
      cache.get("a");
      vi.advanceTimersByTime(50);
      cache.set("c", 3);
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBeUndefined();
    });
  });

  describe("max size / LRU eviction", () => {
    it("evicts least recently used when at capacity", () => {
      const cache = new Cache<string, number>({ maxSize: 2 });
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
    });

    it("does not evict when updating existing key", () => {
      const cache = new Cache<string, number>({ maxSize: 2 });
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("a", 10);
      cache.set("c", 3);
      expect(cache.get("a")).toBe(10);
      expect(cache.get("b")).toBeUndefined();
    });

    it("evicts oldest entry regardless of access order", () => {
      const cache = new Cache<string, number>({ maxSize: 3 });
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.get("a");
      cache.get("b");
      cache.set("d", 4);
      expect(cache.get("c")).toBeUndefined();
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("d")).toBe(4);
    });

    it("has unlimited size when maxSize is Infinity (default)", () => {
      const cache = new Cache<string, number>();
      for (let i = 0; i < 100; i++) {
        cache.set(`key-${i}`, i);
      }
      expect(cache.get("key-0")).toBe(0);
      expect(cache.size()).toBe(100);
    });
  });

  describe("generics", () => {
    it("works with string keys and object values", () => {
      const cache = new Cache<string, { name: string }>();
      cache.set("user", { name: "Alice" });
      expect(cache.get("user")).toEqual({ name: "Alice" });
    });

    it("works with number keys", () => {
      const cache = new Cache<number, string>();
      cache.set(1, "one");
      expect(cache.get(1)).toBe("one");
    });

    it("works with complex key types", () => {
      const cache = new Cache<{ id: number }, string>();
      cache.set({ id: 1 }, "first");
      expect(cache.get({ id: 1 })).toBeUndefined();
    });
  });
});
