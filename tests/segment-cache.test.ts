import { describe, expect, it } from "vitest";

import {
  buildSegmentCacheKey,
  DEFAULT_SEGMENT_CACHE_BYTES,
  DEFAULT_SEGMENT_CACHE_ENTRIES,
  SegmentCache,
  type SegmentCacheEntry,
} from "@/lib/segment-cache";

const IMAGE = "https://example.supabase.co/storage/v1/object/public/rooms/r1/before-image.png";
const OTHER_IMAGE = "https://example.supabase.co/storage/v1/object/public/rooms/r1/after-image.png";

function entry(
  concept: string,
  maskDataUrls: string[],
  scores: number[] = maskDataUrls.map(() => 0.9)
): SegmentCacheEntry {
  return { concept, maskDataUrls, scores };
}

describe("buildSegmentCacheKey", () => {
  // Issue #228 rekey: one billed call per (image, concept), so the cache
  // unit is the whole concept result — no more per-point keys.
  it("keys on the image URL and the concept", () => {
    expect(buildSegmentCacheKey(IMAGE, "sofa")).toBe(`${IMAGE}#sofa`);
  });

  it("gives different images different keys for the same concept", () => {
    expect(buildSegmentCacheKey(IMAGE, "sofa")).not.toBe(
      buildSegmentCacheKey(OTHER_IMAGE, "sofa")
    );
  });

  it("gives different concepts different keys for the same image", () => {
    expect(buildSegmentCacheKey(IMAGE, "sofa")).not.toBe(buildSegmentCacheKey(IMAGE, "chair"));
  });

  it("matches concepts verbatim (they are pre-validated/trimmed upstream)", () => {
    expect(buildSegmentCacheKey(IMAGE, "sofa")).not.toBe(buildSegmentCacheKey(IMAGE, " sofa"));
  });
});

describe("SegmentCache", () => {
  it("defaults to the documented entry and byte bounds", () => {
    const cache = new SegmentCache();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
    expect(DEFAULT_SEGMENT_CACHE_ENTRIES).toBe(8);
    expect(DEFAULT_SEGMENT_CACHE_BYTES).toBe(8 * 1024 * 1024);
  });

  it("returns stored concept results on hit and null on miss", () => {
    const cache = new SegmentCache();
    expect(cache.get(IMAGE, "sofa")).toBeNull();
    cache.put(IMAGE, "sofa", { maskDataUrls: ["mask-a"], scores: [0.9] });
    expect(cache.get(IMAGE, "sofa")).toEqual(
      entry("sofa", ["mask-a"], [0.9])
    );
    expect(cache.get(IMAGE, "chair")).toBeNull();
    expect(cache.get(OTHER_IMAGE, "sofa")).toBeNull();
  });

  it("peek reads without touching LRU recency; get refreshes it", () => {
    const cache = new SegmentCache({ maxEntries: 2 });
    cache.put(IMAGE, "sofa", { maskDataUrls: ["mask-a"], scores: [1] });
    cache.put(IMAGE, "chair", { maskDataUrls: ["mask-b"], scores: [1] });
    // peek("sofa") must NOT make sofa most-recently-used…
    expect(cache.peek(IMAGE, "sofa")).toEqual(entry("sofa", ["mask-a"], [1]));
    cache.put(IMAGE, "rug", { maskDataUrls: ["mask-c"], scores: [1] }); // evicts LRU sofa
    expect(cache.get(IMAGE, "sofa")).toBeNull(); // …so sofa is the eviction victim
    // get() DOES refresh recency: chair is LRU in [chair, rug]…
    expect(cache.get(IMAGE, "chair")).toEqual(entry("chair", ["mask-b"], [1]));
    // …so re-filling sofa now evicts RUG, not chair.
    cache.put(IMAGE, "sofa", { maskDataUrls: ["mask-a2"], scores: [1] });
    expect(cache.get(IMAGE, "rug")).toBeNull();
    expect(cache.get(IMAGE, "chair")).not.toBeNull();
    expect(cache.get(IMAGE, "sofa")).toEqual(entry("sofa", ["mask-a2"], [1]));
  });

  it("tracks approximate bytes from the summed mask data URLs", () => {
    const cache = new SegmentCache();
    cache.put(IMAGE, "sofa", {
      maskDataUrls: ["data:image/png;base64,AAAA", "data:image/png;base64,BB"],
      scores: [0.9, 0.8],
    });
    expect(cache.bytes).toBe(
      "data:image/png;base64,AAAA".length + "data:image/png;base64,BB".length
    );
  });

  it("counts a re-put on an existing key once (size and bytes)", () => {
    const cache = new SegmentCache();
    cache.put(IMAGE, "sofa", { maskDataUrls: ["data:image/png;base64,AAAA"], scores: [1] });
    cache.put(IMAGE, "sofa", { maskDataUrls: ["data:image/png;base64,BB"], scores: [1] });
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe("data:image/png;base64,BB".length);
    expect(cache.get(IMAGE, "sofa")).toEqual(
      entry("sofa", ["data:image/png;base64,BB"], [1])
    );
  });

  it("evicts the least recently used entry beyond maxEntries", () => {
    const cache = new SegmentCache({ maxEntries: 2 });
    cache.put(IMAGE, "sofa", { maskDataUrls: ["mask-1"], scores: [1] });
    cache.put(IMAGE, "chair", { maskDataUrls: ["mask-2"], scores: [1] });
    expect(cache.get(IMAGE, "sofa")).not.toBeNull(); // touch → MRU
    cache.put(IMAGE, "rug", { maskDataUrls: ["mask-3"], scores: [1] }); // evicts "chair"
    expect(cache.size).toBe(2);
    expect(cache.get(IMAGE, "chair")).toBeNull();
    expect(cache.get(IMAGE, "sofa")).not.toBeNull();
    expect(cache.get(IMAGE, "rug")).not.toBeNull();
  });

  it("evicts by byte budget even under the entry cap", () => {
    const cache = new SegmentCache({ maxEntries: 10, maxBytes: 12 });
    cache.put(IMAGE, "sofa", { maskDataUrls: ["abcdef"], scores: [1] }); // 6 bytes
    cache.put(IMAGE, "chair", { maskDataUrls: ["ghijkl"], scores: [1] }); // 12 total, at cap
    expect(cache.size).toBe(2);
    cache.put(IMAGE, "rug", { maskDataUrls: ["mnopqr"], scores: [1] }); // must evict "sofa"
    expect(cache.get(IMAGE, "sofa")).toBeNull();
    expect(cache.get(IMAGE, "chair")).not.toBeNull();
    expect(cache.get(IMAGE, "rug")).not.toBeNull();
    expect(cache.bytes).toBeLessThanOrEqual(12);
  });

  it("clear drops everything (source-switch lifecycle)", () => {
    const cache = new SegmentCache();
    cache.put(IMAGE, "sofa", { maskDataUrls: ["mask-1"], scores: [1] });
    cache.put(OTHER_IMAGE, "sofa", { maskDataUrls: ["mask-2"], scores: [1] });
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
    expect(cache.get(IMAGE, "sofa")).toBeNull();
  });

  it("caches empty detections too (a valid 'no {concept} found' result)", () => {
    const cache = new SegmentCache();
    cache.put(IMAGE, "artwork", { maskDataUrls: [], scores: [] });
    expect(cache.get(IMAGE, "artwork")).toEqual(entry("artwork", [], []));
    expect(cache.bytes).toBe(0);
  });
});
