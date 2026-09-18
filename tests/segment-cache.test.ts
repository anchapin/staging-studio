import { describe, expect, it } from "vitest";

import {
  buildSegmentCacheKey,
  DEFAULT_SEGMENT_CACHE_BYTES,
  DEFAULT_SEGMENT_CACHE_ENTRIES,
  SegmentCache,
} from "@/lib/segment-cache";

const IMAGE = "https://example.supabase.co/storage/v1/object/public/rooms/r1/before-image.png";
const OTHER_IMAGE = "https://example.supabase.co/storage/v1/object/public/rooms/r1/after-image.png";

describe("buildSegmentCacheKey", () => {
  it("keys on the image URL and the integer-rounded point", () => {
    expect(buildSegmentCacheKey(IMAGE, { x: 512.4, y: 383.6 })).toBe(`${IMAGE}#512,384`);
  });

  it("gives different images different keys for the same point", () => {
    expect(buildSegmentCacheKey(IMAGE, { x: 10, y: 10 })).not.toBe(
      buildSegmentCacheKey(OTHER_IMAGE, { x: 10, y: 10 })
    );
  });

  it("gives different points different keys for the same image", () => {
    expect(buildSegmentCacheKey(IMAGE, { x: 10, y: 10 })).not.toBe(
      buildSegmentCacheKey(IMAGE, { x: 10, y: 11 })
    );
  });

  it("rounds sub-pixel neighbours onto the same key (below SAM's resolution)", () => {
    expect(buildSegmentCacheKey(IMAGE, { x: 100.2, y: 50.5 })).toBe(
      buildSegmentCacheKey(IMAGE, { x: 100.4, y: 50.5 })
    );
  });
});

describe("SegmentCache", () => {
  it("defaults to the documented entry and byte bounds", () => {
    const cache = new SegmentCache();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
    expect(DEFAULT_SEGMENT_CACHE_ENTRIES).toBe(16);
    expect(DEFAULT_SEGMENT_CACHE_BYTES).toBe(4 * 1024 * 1024);
  });

  it("returns stored masks on hit and null on miss", () => {
    const cache = new SegmentCache();
    expect(cache.get(IMAGE, { x: 5, y: 5 })).toBeNull();
    cache.put(IMAGE, { x: 5, y: 5 }, "data:image/png;base64,AAAA");
    expect(cache.get(IMAGE, { x: 5, y: 5 })).toBe("data:image/png;base64,AAAA");
    expect(cache.get(IMAGE, { x: 5, y: 6 })).toBeNull();
    expect(cache.get(OTHER_IMAGE, { x: 5, y: 5 })).toBeNull();
  });

  it("tracks approximate bytes from the stored data URLs", () => {
    const cache = new SegmentCache();
    cache.put(IMAGE, { x: 1, y: 1 }, "data:image/png;base64,AAAA");
    expect(cache.bytes).toBe("data:image/png;base64,AAAA".length);
    cache.put(IMAGE, { x: 2, y: 2 }, "data:image/png;base64,BBBBBBBB");
    expect(cache.bytes).toBe(
      "data:image/png;base64,AAAA".length + "data:image/png;base64,BBBBBBBB".length
    );
  });

  it("counts a re-put on an existing key once (size and bytes)", () => {
    const cache = new SegmentCache();
    cache.put(IMAGE, { x: 1, y: 1 }, "data:image/png;base64,AAAA");
    cache.put(IMAGE, { x: 1, y: 1 }, "data:image/png;base64,BB");
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe("data:image/png;base64,BB".length);
    expect(cache.get(IMAGE, { x: 1, y: 1 })).toBe("data:image/png;base64,BB");
  });

  it("evicts the least recently used entry beyond maxEntries", () => {
    const cache = new SegmentCache({ maxEntries: 2 });
    cache.put(IMAGE, { x: 1, y: 1 }, "mask-1");
    cache.put(IMAGE, { x: 2, y: 2 }, "mask-2");
    expect(cache.get(IMAGE, { x: 1, y: 1 })).toBe("mask-1"); // touch → MRU
    cache.put(IMAGE, { x: 3, y: 3 }, "mask-3"); // evicts (2,2)
    expect(cache.size).toBe(2);
    expect(cache.get(IMAGE, { x: 2, y: 2 })).toBeNull();
    expect(cache.get(IMAGE, { x: 1, y: 1 })).toBe("mask-1");
    expect(cache.get(IMAGE, { x: 3, y: 3 })).toBe("mask-3");
  });

  it("evicts by byte budget even under the entry cap", () => {
    const cache = new SegmentCache({ maxEntries: 10, maxBytes: 12 });
    cache.put(IMAGE, { x: 1, y: 1 }, "abcdef"); // 6 bytes
    cache.put(IMAGE, { x: 2, y: 2 }, "ghijkl"); // 6 bytes → 12 total, at cap
    expect(cache.size).toBe(2);
    cache.put(IMAGE, { x: 3, y: 3 }, "mnopqr"); // 6 bytes → must evict (1,1)
    expect(cache.get(IMAGE, { x: 1, y: 1 })).toBeNull();
    expect(cache.get(IMAGE, { x: 2, y: 2 })).toBe("ghijkl");
    expect(cache.get(IMAGE, { x: 3, y: 3 })).toBe("mnopqr");
    expect(cache.bytes).toBeLessThanOrEqual(12);
  });

  it("clear drops everything", () => {
    const cache = new SegmentCache();
    cache.put(IMAGE, { x: 1, y: 1 }, "mask-1");
    cache.put(OTHER_IMAGE, { x: 2, y: 2 }, "mask-2");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
    expect(cache.get(IMAGE, { x: 1, y: 1 })).toBeNull();
  });
});
