/**
 * Latency instrumentation for SAM 3.1 concept pre-warm (issue #228).
 *
 * Pure event builders so the editor emits greppable one-line JSON
 * timing events. Nothing here performs IO or reads the clock — callers
 * capture `performance.now()` themselves and pass the measured
 * millisecond values in, keeping this module testable.
 *
 * Operator protocol: open the mask editor, wait for the furniture
 * detection to fire, and read the `[segment-timing]` lines in the
 * browser DevTools console. A warm run logs `"ok":true`; a failed
 * run logs `"ok":false` with the duration of the failed attempt.
 *
 * Side effects: none (pure); the optional `emitSegmentTiming` helper
 * is the only piece that touches the console.
 */

/** Stable console prefix so operators can filter client timing lines. */
export const SEGMENT_TIMING_LOG_PREFIX = "[segment-timing]";

/** Editor-open pre-warm ping outcome. */
export interface SegmentPrewarmTimingEvent {
  event: "segment_prewarm_timing";
  /** Pre-warm request duration in whole milliseconds. */
  ms: number;
  ok: boolean;
  imageUrl: string;
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
 * `[segment-timing] {"event":"segment_prewarm_timing",...}`.
 * Side effects: one console.info call.
 */
export function emitSegmentTiming(event: SegmentPrewarmTimingEvent): void {
  console.info(SEGMENT_TIMING_LOG_PREFIX, JSON.stringify(event));
}
