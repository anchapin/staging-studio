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
}

export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
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
  private readonly store = new Map<K, CacheEntry<V>>();

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl ?? Infinity;
    this.maxSize = options.maxSize ?? Infinity;
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
    if (this.store.has(key)) {
      const entry = this.store.get(key)!;
      this.store.delete(key);
      this.store.set(key, { value, expiresAt: entry.expiresAt });
      return;
    }
    if (this.store.size >= this.maxSize) {
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    const expiresAt = this.ttl === Infinity ? Infinity : Date.now() + this.ttl;
    this.store.set(key, { value, expiresAt });
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
}

export function runWithCacheContext<T>(fn: () => T): T {
  const cache: RequestCache = { store: new Map<string, CacheEntry<unknown>>() };
  return asyncLocalStorage.run(cache, fn) as T;
}
