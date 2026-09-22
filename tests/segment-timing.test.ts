import { describe, expect, it, vi } from "vitest";

import {
  buildSegmentPrewarmTimingEvent,
  emitSegmentTiming,
  SEGMENT_TIMING_LOG_PREFIX,
} from "@/lib/segment-timing";

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
  it("emits one greppable console.info line with the stable prefix", () => {
    const info = vi.fn();
    vi.stubGlobal("console", { info });
    emitSegmentTiming(
      buildSegmentPrewarmTimingEvent({ ms: 42, ok: true, imageUrl: "https://x/b.png" })
    );
    expect(info).toHaveBeenCalledTimes(1);
    const [prefix, payload] = info.mock.calls[0] as [string, string];
    expect(prefix).toBe(SEGMENT_TIMING_LOG_PREFIX);
    expect(JSON.parse(payload)).toEqual({
      event: "segment_prewarm_timing",
      ms: 42,
      ok: true,
      imageUrl: "https://x/b.png",
    });
  });
});
