import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSegmentPrewarmTimingEvent,
  buildSegmentServerTimingEvent,
  buildSegmentTimingEvent,
  emitSegmentTiming,
  formatSegmentMs,
  SEGMENT_TIMING_LOG_PREFIX,
} from "@/lib/segment-timing";

describe("formatSegmentMs", () => {
  it("formats sub-second durations as whole milliseconds", () => {
    expect(formatSegmentMs(0)).toBe("0ms");
    expect(formatSegmentMs(812.4)).toBe("812ms");
    expect(formatSegmentMs(999.6)).toBe("1000ms"); // rounds, still the ms branch
  });

  it("formats second-and-above durations with two decimals", () => {
    expect(formatSegmentMs(1000)).toBe("1.00s");
    expect(formatSegmentMs(1234)).toBe("1.23s");
    expect(formatSegmentMs(15_000)).toBe("15.00s");
  });
});

describe("buildSegmentTimingEvent", () => {
  it("builds a rounded client click event", () => {
    expect(
      buildSegmentTimingEvent({
        ms: 812.6,
        source: "network",
        prewarmed: true,
        imageUrl: "https://example.supabase.co/before.png",
      })
    ).toEqual({
      event: "segment_timing",
      ms: 813,
      source: "network",
      prewarmed: true,
      imageUrl: "https://example.supabase.co/before.png",
    });
  });

  it("marks cache hits with the cache source", () => {
    const event = buildSegmentTimingEvent({
      ms: 0.4,
      source: "cache",
      prewarmed: false,
      imageUrl: "https://example.supabase.co/before.png",
    });
    expect(event.source).toBe("cache");
    expect(event.ms).toBe(0);
  });
});

describe("buildSegmentServerTimingEvent", () => {
  it("builds a warm pre-warm event with a null fal duration", () => {
    expect(
      buildSegmentServerTimingEvent({ totalMs: 120.4, falMs: null, warm: true, roomId: "room_1" })
    ).toEqual({
      event: "segment_server_timing",
      totalMs: 120,
      falMs: null,
      warm: true,
      roomId: "room_1",
    });
  });

  it("builds a real-click event with the rounded fal split", () => {
    expect(
      buildSegmentServerTimingEvent({
        totalMs: 2400.7,
        falMs: 2100.2,
        warm: false,
        roomId: "room_1",
      })
    ).toEqual({
      event: "segment_server_timing",
      totalMs: 2401,
      falMs: 2100,
      warm: false,
      roomId: "room_1",
    });
  });
});

describe("buildSegmentPrewarmTimingEvent", () => {
  it("builds success and failure events", () => {
    expect(
      buildSegmentPrewarmTimingEvent({ ms: 210.5, ok: true, imageUrl: "https://x/b.png" })
    ).toEqual({
      event: "segment_prewarm_timing",
      ms: 211,
      ok: true,
      imageUrl: "https://x/b.png",
    });
    expect(
      buildSegmentPrewarmTimingEvent({ ms: 50, ok: false, imageUrl: "https://x/b.png" }).ok
    ).toBe(false);
  });
});

describe("emitSegmentTiming", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits one greppable console.info line with the stable prefix", () => {
    const info = vi.fn();
    vi.stubGlobal("console", { info });
    emitSegmentTiming(
      buildSegmentTimingEvent({
        ms: 42,
        source: "cache",
        prewarmed: false,
        imageUrl: "https://x/b.png",
      })
    );
    expect(info).toHaveBeenCalledTimes(1);
    const [prefix, payload] = info.mock.calls[0] as [string, string];
    expect(prefix).toBe(SEGMENT_TIMING_LOG_PREFIX);
    expect(JSON.parse(payload)).toEqual({
      event: "segment_timing",
      ms: 42,
      source: "cache",
      prewarmed: false,
      imageUrl: "https://x/b.png",
    });
  });
});
