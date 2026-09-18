/**
 * Latency instrumentation for the SAM click-to-segment flow (issue #202).
 *
 * Pure event builders + formatting so the editor (client) and the
 * /api/segment route (server) emit identical, greppable one-line JSON
 * timing events. Nothing here performs IO or reads the clock — callers
 * capture `performance.now()`/`Date.now()` themselves and pass the
 * measured millisecond values in, keeping this module testable.
 *
 * Operator protocol (one command away — see PR body):
 * 1. Client: open the mask editor, click with Select Object, and read the
 *    `[segment-timing]` lines in the browser DevTools console. A click
 *    fired before the editor-open pre-warm completes logs
 *    `"prewarmed":false` (cold); after it completes `"prewarmed":true`
 *    (warm); cache hits log `"source":"cache"` (~0 ms).
 * 2. Server: `segment_server_timing` lines in the server logs (Vercel
 *    log drain / `npm run dev` output) split total route time from the
 *    `fal-ai/sam` call time (`falMs`) — the part no pre-warm can remove.
 *
 * Side effects: none (pure); the optional `emitSegmentTiming` helper is
 * the only piece that touches the console.
 */

/** Stable console prefix so operators can filter client timing lines. */
export const SEGMENT_TIMING_LOG_PREFIX = "[segment-timing]";

/** Where a click's mask came from. */
export type SegmentTimingSource = "cache" | "network";

/** Client-side click→result event (successes only; failures surface as errors). */
export interface SegmentTimingEvent {
  event: "segment_timing";
  /** Click → response (or cache hit) duration in whole milliseconds. */
  ms: number;
  source: SegmentTimingSource;
  /** True when the editor-open pre-warm ping had completed before the click. */
  prewarmed: boolean;
  imageUrl: string;
}

/** Server-side route event from POST /api/segment (success paths only). */
export interface SegmentServerTimingEvent {
  event: "segment_server_timing";
  /** Handler start → response, whole milliseconds. */
  totalMs: number;
  /** Duration of the fal.subscribe call, or null when no fal call was made. */
  falMs: number | null;
  /** True for pre-warm pings (which never call fal — zero provider cost). */
  warm: boolean;
  roomId: string | null;
}

/** Editor-open pre-warm ping outcome. */
export interface SegmentPrewarmTimingEvent {
  event: "segment_prewarm_timing";
  /** Pre-warm request duration in whole milliseconds. */
  ms: number;
  ok: boolean;
  imageUrl: string;
}

/**
 * Formats a duration for humans: whole milliseconds below a second,
 * fixed two-decimal seconds at or above it ("812ms", "1.23s").
 * Side effects: none (pure).
 */
export function formatSegmentMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Builds a client click-timing event. Side effects: none (pure). */
export function buildSegmentTimingEvent(input: {
  ms: number;
  source: SegmentTimingSource;
  prewarmed: boolean;
  imageUrl: string;
}): SegmentTimingEvent {
  return {
    event: "segment_timing",
    ms: Math.round(input.ms),
    source: input.source,
    prewarmed: input.prewarmed,
    imageUrl: input.imageUrl,
  };
}

/** Builds a server route-timing event. Side effects: none (pure). */
export function buildSegmentServerTimingEvent(input: {
  totalMs: number;
  falMs: number | null;
  warm: boolean;
  roomId: string | null;
}): SegmentServerTimingEvent {
  return {
    event: "segment_server_timing",
    totalMs: Math.round(input.totalMs),
    falMs: input.falMs === null ? null : Math.round(input.falMs),
    warm: input.warm,
    roomId: input.roomId,
  };
}

/** Builds a pre-warm ping event. Side effects: none (pure). */
export function buildSegmentPrewarmTimingEvent(input: {
  ms: number;
  ok: boolean;
  imageUrl: string;
}): SegmentPrewarmTimingEvent {
  return {
    event: "segment_prewarm_timing",
    ms: Math.round(input.ms),
    ok: input.ok,
    imageUrl: input.imageUrl,
  };
}

/**
 * Emits a timing event as one greppable console line:
 * `[segment-timing] {"event":"segment_timing",...}`.
 * Side effects: one console.info call.
 */
export function emitSegmentTiming(
  event: SegmentTimingEvent | SegmentServerTimingEvent | SegmentPrewarmTimingEvent
): void {
  console.info(SEGMENT_TIMING_LOG_PREFIX, JSON.stringify(event));
}
