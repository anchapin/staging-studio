/**
 * Serverless-safe in-memory cache with TTL and LRU eviction.
 * Uses AsyncLocalStorage for request-scoped isolation in Node.js environments.
 * Falls back to instance-level Map when no ALS context is active.
 *
 * In serverless environments:
 * - Each cold-start invocation gets a fresh process with an empty cache
 * - Concurrent requests may run in different processes with divergent state
 * - This implementation uses AsyncLocalStorage to provide request-scoped isolation
 *   within a single process, preventing concurrent requests from polluting each other's cache
 */

import { AsyncLocalStorage } from "async_hooks";

export interface CacheEntry<V> {
  value: V;
  expiresAt: number;
  insertedAt?: number;
}

export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
  maxAge?: number;
}

interface RequestCache {
  store: Map<string, CacheEntry<unknown>>;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestCache>();

function isAsyncLocalStorageAvailable(): boolean {
  try {
    return typeof AsyncLocalStorage !== "undefined";
  } catch {
    return false;
  }
}

export class Cache<K, V> {
  private readonly ttl: number;
  private readonly maxSize: number;
  private readonly maxAge: number;
  private readonly store = new Map<K, CacheEntry<V>>();
  private readonly inflight = new Map<K, Promise<V>>();
  private readonly inflightIncr = new Map<K, Promise<number>>();

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl ?? Infinity;
    this.maxSize = options.maxSize ?? Infinity;
    this.maxAge = options.maxAge ?? Infinity;
  }

  sweep(maxAgeMs?: number): number {
    const maxAge = maxAgeMs ?? this.maxAge;
    if (!isFinite(maxAge)) return 0;
    const cutoff = Date.now() - maxAge;
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.insertedAt !== undefined && entry.insertedAt <= cutoff) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private getFromStore(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      const alsStore = this.getAlsStore();
      if (alsStore) {
        const strKey = String(key);
        const alsEntry = alsStore.get(strKey);
        if (!alsEntry) return undefined;
        if (Date.now() > alsEntry.expiresAt) {
          alsStore.delete(strKey);
          return undefined;
        }
        alsStore.delete(strKey);
        alsStore.set(strKey, alsEntry);
        return alsEntry.value as V;
      }
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  private getAlsStore(): Map<string, CacheEntry<unknown>> | undefined {
    if (isAsyncLocalStorageAvailable()) {
      return asyncLocalStorage.getStore()?.store;
    }
    return undefined;
  }

  get(key: K): V | undefined {
    return this.getFromStore(key);
  }

  set(key: K, value: V): void {
    this.sweep();
    const strKey = String(key);
    const alsStore = this.getAlsStore();
    if (alsStore) {
      if (alsStore.has(strKey)) {
        const entry = alsStore.get(strKey)!;
        alsStore.delete(strKey);
        alsStore.set(strKey, { value, expiresAt: entry.expiresAt });
        return;
      }
      if (alsStore.size >= this.maxSize) {
        const first = alsStore.keys().next().value;
        if (first !== undefined) alsStore.delete(first);
      }
      const expiresAt = this.ttl === Infinity ? Infinity : Date.now() + this.ttl;
      alsStore.set(strKey, { value, expiresAt });
      return;
    }
    const now = Date.now();
    if (this.store.has(key)) {
      const entry = this.store.get(key)!;
      this.store.delete(key);
      const expiresAt = this.ttl === Infinity ? Infinity : now + this.ttl;
      this.store.set(key, { value, expiresAt, insertedAt: entry.insertedAt });
      return;
    }
    if (this.store.size >= this.maxSize) {
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    const expiresAt = this.ttl === Infinity ? Infinity : now + this.ttl;
    this.store.set(key, { value, expiresAt, insertedAt: now });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    const alsStore = this.getAlsStore();
    if (alsStore) {
      return alsStore.delete(String(key));
    }
    return this.store.delete(key);
  }

  clear(): void {
    const alsStore = this.getAlsStore();
    if (alsStore) {
      alsStore.clear();
    }
    this.store.clear();
  }

  size(): number {
    const alsStore = this.getAlsStore();
    if (alsStore) {
      const firstKey = Array.from(alsStore.keys())[0];
      if (firstKey !== undefined) {
        const entry = alsStore.get(firstKey);
        if (entry && Date.now() > entry.expiresAt) {
          alsStore.delete(firstKey);
        }
      }
      return alsStore.size;
    }
    const first = this.store.keys().next().value;
    if (first !== undefined) {
      void this.get(first);
    }
    return this.store.size;
  }

  async getOrSet(
    key: K,
    factory: () => Promise<V>,
    ttlMs: number,
  ): Promise<V> {
    const strKey = String(key);
    const existing = this.get(key);
    if (existing !== undefined) {
      this.set(key, existing);
      return existing;
    }
    const inflight = this.inflight.get(key as K);
    if (inflight) return inflight;
    const promise = factory().finally(() => {
      this.inflight.delete(key as K);
    });
    this.inflight.set(key as K, promise as Promise<V>);
    const value = await promise;
    const alsStore = this.getAlsStore();
    if (alsStore) {
      if (alsStore.has(strKey)) {
        const entry = alsStore.get(strKey)!;
        alsStore.delete(strKey);
        alsStore.set(strKey, { value, expiresAt: entry.expiresAt });
      } else {
        const expiresAt = ttlMs === Infinity ? Infinity : Date.now() + ttlMs;
        alsStore.set(strKey, { value, expiresAt, insertedAt: Date.now() });
      }
    } else {
      if (this.store.has(key)) {
        const entry = this.store.get(key)!;
        this.store.delete(key);
        this.store.set(key, { value, expiresAt: entry.expiresAt, insertedAt: entry.insertedAt });
      } else {
        const expiresAt = ttlMs === Infinity ? Infinity : Date.now() + ttlMs;
        this.store.set(key, { value, expiresAt, insertedAt: Date.now() });
      }
    }
    return value;
  }

  async incr(key: K, max: number, ttlMs: number): Promise<number> {
    const inflight = this.inflightIncr.get(key as K);
    if (inflight) {
      await inflight;
      const alsStore = this.getAlsStore();
      if (alsStore) {
        const strKey = String(key);
        const entry = alsStore.get(strKey);
        if (entry) return Math.min((entry.value as number) + 1, max);
      }
      const entry = this.store.get(key);
      if (entry) return Math.min((entry.value as number) + 1, max);
      return Math.min(1, max);
    }
    const promise = this._doIncr(key, max, ttlMs).finally(() => {
      this.inflightIncr.delete(key as K);
    });
    this.inflightIncr.set(key as K, promise);
    return promise;
  }

  private async _doIncr(key: K, max: number, ttlMs: number): Promise<number> {
    const strKey = String(key);
    const alsStore = this.getAlsStore();
    if (alsStore) {
      const entry = alsStore.get(strKey);
      const current = entry ? (entry.value as number) : 0;
      if (current >= max) return max;
      const newVal = current + 1;
      const expiresAt = ttlMs === Infinity ? Infinity : Date.now() + ttlMs;
      alsStore.set(strKey, { value: newVal as V, expiresAt, insertedAt: Date.now() });
      return newVal;
    }
    const entry = this.store.get(key);
    const current = entry ? (entry.value as number) : 0;
    if (current >= max) return max;
    const newVal = current + 1;
    const expiresAt = ttlMs === Infinity ? Infinity : Date.now() + ttlMs;
    this.store.set(key, { value: newVal as V, expiresAt, insertedAt: Date.now() });
    return newVal;
  }
}

export function runWithCacheContext<T>(fn: () => T): T {
  const cache: RequestCache = { store: new Map<string, CacheEntry<unknown>>() };
  return asyncLocalStorage.run(cache, fn) as T;
}
