/**
 * In-memory cache with TTL and LRU eviction.
 * Used to cache VisionLabel lookups and avoid hitting the database on every request.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
}

export class Cache<K, V> {
  private store = new Map<K, CacheEntry<V>>();
  private readonly ttl: number;
  private readonly maxSize: number;

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl ?? Infinity;
    this.maxSize = options.maxSize ?? Infinity;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
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
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    void this.get(Array.from(this.store.keys())[0]);
    return this.store.size;
  }
}
