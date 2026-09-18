/**
 * Client-side cache for SAM 3.1 concept-selection responses (issue #228,
 * rekeying the issue #202 point cache).
 *
 * Every concept detection on a NEW (image, concept) pair costs one
 * `fal-ai/sam-3-1/image` call (see `furnishing-detection.ts`). One call
 * returns ALL instances of that concept, so the cache unit is the whole
 * result: keying by `(imageUrl, concept)` makes re-selecting an
 * already-detected concept (chip re-clicks, toggling instances after a
 * Clear Mask, returning from another concept) instant and free — zero
 * provider calls.
 *
 * Keying
 * ------
 * `buildSegmentCacheKey(imageUrl, concept)` = `<imageUrl>#<concept>`.
 *
 * - Image is part of the key, so before/after variant switches can never
 *   cross-contaminate: a different source image simply misses.
 * - The concept is matched verbatim (pre-validated by
 *   `isValidConceptName`, so it is already trimmed).
 *
 * Invalidation / lifecycle
 * ------------------------
 * The editor owns ONE SegmentCache instance per mount (a `useRef`) and
 * calls `clear()` when the user switches the inpaint source. That makes
 * the lifetime strictly "one editing session for one image":
 *
 * - Switching variant (before/after) inside the editor → explicit clear.
 * - Re-uploading a photo happens outside the editor and remounts it on
 *   navigation → fresh cache.
 * - Within a mounted editor the image bytes cannot change (there is no
 *   upload path in the editor), so a stable Supabase storage URL is safe
 *   to key on for the session.
 *
 * Memory bounds
 * -------------
 * Two caps, both enforced on `put()` with LRU (insertion-order) eviction:
 * `maxEntries` (default 8) and `maxBytes` (default 8 MiB), where bytes
 * are approximated by the summed data-URL string lengths of an entry's
 * masks (ASCII base64, so code units ≈ bytes). One entry holds up to 30
 * instance masks (`FURNISHING_DETECTION_MAX_MASKS`), so entries run
 * larger than the old per-point masks; the byte budget covers a full
 * entry set. Real per-instance masks are tens of KB, so the typical
 * footprint is well under 1 MiB.
 *
 * Side effects: none (pure in-memory data structure).
 */

/** One concept detection result, exactly as the route returns it. */
export interface SegmentCacheEntry {
  /** The validated concept this result was detected with. */
  concept: string;
  /** Per-instance masks (data URLs), score-ranked. */
  maskDataUrls: string[];
  /** Provider confidence per instance, parallel to `maskDataUrls`. */
  scores: number[];
}

export interface SegmentCacheOptions {
  /** Maximum stored concept results (LRU-evicted). Default 8. */
  maxEntries?: number;
  /** Maximum approximate memory for stored mask data URLs, in bytes. Default 8 MiB. */
  maxBytes?: number;
}

export const DEFAULT_SEGMENT_CACHE_ENTRIES = 8;
export const DEFAULT_SEGMENT_CACHE_BYTES = 8 * 1024 * 1024;

/**
 * Builds the cache key for a concept detection result. `imageUrl` is
 * used verbatim so different images can never share entries; the concept
 * is appended as-is (it is pre-validated — trimmed, normalized charset —
 * so no further key munging is needed).
 * Side effects: none (pure).
 */
export function buildSegmentCacheKey(imageUrl: string, concept: string): string {
  return `${imageUrl}#${concept}`;
}

function approxEntryBytes(entry: SegmentCacheEntry): number {
  let total = 0;
  for (const url of entry.maskDataUrls) total += url.length;
  return total;
}

export class SegmentCache {
  private readonly entries = new Map<string, SegmentCacheEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private approxBytes = 0;

  constructor(options: SegmentCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_SEGMENT_CACHE_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_SEGMENT_CACHE_BYTES;
  }

  /** Number of cached concept results. */
  get size(): number {
    return this.entries.size;
  }

  /** Approximate memory used by cached mask data URLs, in bytes. */
  get bytes(): number {
    return this.approxBytes;
  }

  /**
   * Returns the cached result for an already-detected (image, concept)
   * pair, refreshing its LRU recency. Returns null on a miss. Call from
   * event handlers; use `peek` for render-time reads.
   * Side effects: none (recency refresh is internal to the cache).
   */
  get(imageUrl: string, concept: string): SegmentCacheEntry | null {
    const key = buildSegmentCacheKey(imageUrl, concept);
    const hit = this.entries.get(key);
    if (hit === undefined) return null;
    // Map iteration order is insertion order: delete + re-insert moves the
    // entry to the back (most recently used).
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  /**
   * Read-only cache lookup that does NOT refresh LRU recency — safe to
   * call during render (the auto-fire hook's cache resolution reads this
   * way). Returns null on a miss.
   * Side effects: none.
   */
  peek(imageUrl: string, concept: string): SegmentCacheEntry | null {
    return this.entries.get(buildSegmentCacheKey(imageUrl, concept)) ?? null;
  }

  /**
   * Stores a provider-returned concept result, evicting least-recently-
   * used entries until both caps hold. Re-putting an existing key updates
   * it in place (at its byte size delta) and marks it most recently used.
   * Side effects: none beyond the cache's own state.
   */
  put(
    imageUrl: string,
    concept: string,
    result: { maskDataUrls: string[]; scores: number[] }
  ): void {
    const key = buildSegmentCacheKey(imageUrl, concept);
    const entry: SegmentCacheEntry = {
      concept,
      maskDataUrls: result.maskDataUrls,
      scores: result.scores,
    };
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.approxBytes -= approxEntryBytes(previous);
      this.entries.delete(key);
    }
    this.entries.set(key, entry);
    this.approxBytes += approxEntryBytes(entry);
    this.evict();
  }

  /** Drops every cached result (called on inpaint source switches). */
  clear(): void {
    this.entries.clear();
    this.approxBytes = 0;
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries) {
      this.evictOldest();
    }
    while (this.approxBytes > this.maxBytes && this.entries.size > 0) {
      this.evictOldest();
    }
  }

  private evictOldest(): void {
    const oldest = this.entries.keys().next();
    if (oldest.done) return;
    const value = this.entries.get(oldest.value);
    this.approxBytes -= value ? approxEntryBytes(value) : 0;
    this.entries.delete(oldest.value);
  }
}
