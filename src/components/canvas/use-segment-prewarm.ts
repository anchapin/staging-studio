"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildSegmentPrewarmTimingEvent,
  emitSegmentTiming,
} from "@/lib/segment-timing";

/**
 * Pre-warms the SAM click-to-segment path when the mask editor opens
 * (issue #202).
 *
 * WHY A PING AND NOT AN EMBEDDING
 * -------------------------------
 * `fal-ai/sam` (see `segment-mask.ts`) exposes no image-embedding
 * input/output: the SAM image encoder runs inside every billed call, on
 * fal's servers, and nothing about it is cacheable from our side. What
 * IS pre-warmable is everything OUR side does on a click: the Next.js
 * route function itself (a serverless cold start in production), the
 * Supabase auth JWT check, and the Prisma connection + room-ownership
 * query. This hook fires ONE `POST /api/segment` request with
 * `warm: true` as soon as the editor's image has loaded; the route runs
 * exactly that auth + ownership path and returns early WITHOUT calling
 * fal — so a pre-warm costs zero provider money (0 fal-ai/sam calls vs
 * the 1 call every real click spends).
 *
 * Lifecycle
 * ---------
 * - Fires once per (roomId, imageUrl, imageWidth×imageHeight) key: the
 *   initial editor open, and again if the inpaint source switches to a
 *   different image (different URL) or the measured dimensions change.
 * - Failures are SILENT by design: a failed pre-warm only means the next
 *   click pays the cold path; toasting infra warm-up noise would be the
 *   exact opacity complaint this issue fixes. The outcome is still
 *   observable via the `segment_prewarm_timing` console event.
 *
 * Side effects: one fetch per key (aborted on cleanup/unmount) and one
 * `segment_prewarm_timing` console event per attempt.
 */

/** States of the editor-open pre-warm ping. */
export type SegmentPrewarmStatus = "idle" | "warming" | "warm" | "failed";

interface UseSegmentPrewarmArgs {
  /** Master gate — mirror of the SAM tool visibility (the flag kill switch). */
  enabled: boolean;
  roomId: string;
  /** The source image URL the editor is currently editing (null until known). */
  imageUrl: string | null;
  /** Measured natural width of that image (null until it has loaded). */
  imageWidth: number | null;
  /** Measured natural height of that image (null until it has loaded). */
  imageHeight: number | null;
}

export function useSegmentPrewarm({
  enabled,
  roomId,
  imageUrl,
  imageWidth,
  imageHeight,
}: UseSegmentPrewarmArgs): SegmentPrewarmStatus {
  const [status, setStatus] = useState<SegmentPrewarmStatus>("idle");
  // Dedupe guard: the effect re-runs on every render where its deps are
  // re-created; a completed (or in-flight) key must not re-fire.
  const warmedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !imageUrl || !imageWidth || !imageHeight) {
      setStatus("idle");
      return;
    }
    const key = `${roomId}|${imageUrl}|${imageWidth}x${imageHeight}`;
    if (warmedKeyRef.current === key) return;
    warmedKeyRef.current = key;
    setStatus("warming");

    const controller = new AbortController();
    const startedAt = performance.now();
    const prewarm = fetch("/api/segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        roomId,
        imageUrl,
        // The schema validates the full click shape; this probe point is
        // within bounds and never executed (the route returns pre-fal).
        point: {
          x: Math.round(imageWidth / 2),
          y: Math.round(imageHeight / 2),
        },
        imageWidth,
        imageHeight,
        warm: true,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Pre-warm failed with HTTP ${response.status}`);
        }
        setStatus("warm");
        emitSegmentTiming(
          buildSegmentPrewarmTimingEvent({
            ms: performance.now() - startedAt,
            ok: true,
            imageUrl,
          })
        );
      })
      .catch(() => {
        // Aborts are lifecycle noise (dep change/unmount), not failures.
        if (controller.signal.aborted) return;
        setStatus("failed");
        emitSegmentTiming(
          buildSegmentPrewarmTimingEvent({
            ms: performance.now() - startedAt,
            ok: false,
            imageUrl,
          })
        );
      });

    return () => {
      controller.abort();
      // Allow the next effect run to re-fire for this key (StrictMode
      // remounts abort the first attempt — the retry must not be deduped
      // away by the guard above).
      if (warmedKeyRef.current === key) {
        warmedKeyRef.current = null;
      }
    };
  }, [enabled, roomId, imageUrl, imageWidth, imageHeight]);

  return status;
}
