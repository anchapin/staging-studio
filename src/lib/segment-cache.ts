/**
 * Client-side cache for SAM click-to-segment responses (issue #202).
 *
 * Every "Select Object" click on a NEW point costs one `fal-ai/sam` call
 * (the endpoint has no embedding input/output — see `segment-mask.ts` —
 * so the image is re-encoded inside each billed call). This cache removes
 * the cost of RE-selecting a point that was already segmented during the
 * same editing session: the exact mask returned by the provider is served
 * from memory instantly, with zero provider calls.
 *
 * Keying
 * ------
 * `buildSegmentCacheKey(imageUrl, point)` = `<imageUrl>#<roundedX>,<roundedY>`.
 *
 * - Image is part of the key, so before/after variant switches can never
 *   cross-contaminate: a different source image simply misses.
 * - Points round to integer natural pixels. Sub-pixel deltas (<1px) are
 *   far below SAM's effective input resolution (the model downsizes to
 *   ~1024 on the long edge), so returning the mask for a point 0.x px
 *   away is materially identical — while keeping keys finite and stable.
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
 * `maxEntries` (default 16) and `maxBytes` (default 4 MiB), where bytes
 * are approximated by the data-URL string length (ASCII base64, so code
 * units ≈ bytes). The server caps a mask response at 10 MiB
 * (`MAX_MASK_RESPONSE_BYTES` in `api/segment/route.ts`); entries × that
 * worst case would be ~160 MiB, which is exactly why the byte budget
 * exists. Real white-on-black masks are tens of KB, so the typical
 * footprint is well under 1 MiB.
 *
 * Side effects: none (pure in-memory data structure).
 */

/** A click point in the source image's natural pixel space. */
export interface SegmentCachePoint {
  x: number;
  y: number;
}

export interface SegmentCacheOptions {
  /** Maximum stored masks (LRU-evicted). Default 16. */
  maxEntries?: number;
  /** Maximum approximate memory for stored data URLs, in bytes. Default 4 MiB. */
  maxBytes?: number;
}

export const DEFAULT_SEGMENT_CACHE_ENTRIES = 16;
export const DEFAULT_SEGMENT_CACHE_BYTES = 4 * 1024 * 1024;

/**
 * Builds the cache key for a segmentation result. Points round to integer
 * natural pixels (see module doc for why that is safe); `imageUrl` is used
 * verbatim so different images can never share entries.
 * Side effects: none (pure).
 */
export function buildSegmentCacheKey(imageUrl: string, point: SegmentCachePoint): string {
  return `${imageUrl}#${Math.round(point.x)},${Math.round(point.y)}`;
}

export class SegmentCache {
  private readonly entries = new Map<string, string>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private approxBytes = 0;

  constructor(options: SegmentCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_SEGMENT_CACHE_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_SEGMENT_CACHE_BYTES;
  }

  /** Number of cached masks. */
  get size(): number {
    return this.entries.size;
  }

  /** Approximate memory used by cached data URLs, in bytes. */
  get bytes(): number {
    return this.approxBytes;
  }

  /**
   * Returns the cached mask for an already-segmented point, refreshing its
   * LRU recency. Returns null on a miss (new point or new image).
   * Side effects: none (recency refresh is internal to the cache).
   */
  get(imageUrl: string, point: SegmentCachePoint): string | null {
    const key = buildSegmentCacheKey(imageUrl, point);
    const hit = this.entries.get(key);
    if (hit === undefined) return null;
    // Map iteration order is insertion order: delete + re-insert moves the
    // entry to the back (most recently used).
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  /**
   * Stores a provider-returned mask, evicting least-recently-used entries
   * until both caps hold. Re-putting an existing key updates it in place
   * (at its byte size delta) and marks it most recently used.
   * Side effects: none beyond the cache's own state.
   */
  put(imageUrl: string, point: SegmentCachePoint, maskDataUrl: string): void {
    const key = buildSegmentCacheKey(imageUrl, point);
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.approxBytes -= previous.length;
      this.entries.delete(key);
    }
    this.entries.set(key, maskDataUrl);
    this.approxBytes += maskDataUrl.length;
    this.evict();
  }

  /** Drops every cached mask (called on inpaint source switches). */
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
    this.approxBytes -= value?.length ?? 0;
    this.entries.delete(oldest.value);
  }
}
