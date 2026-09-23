"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildSegmentPrewarmTimingEvent,
  emitSegmentTiming,
} from "@/lib/segment-timing";
import type { SegmentCacheEntry } from "@/lib/segment-cache";

/**
 * Auto-fires the SAM 3.1 concept detection when the mask editor opens
 * (issue #228) — and on every concept-chip switch.
 *
 * WHY A REAL CALL AND NOT A PING
 * ------------------------------
 * SAM 3.1 concept selection (issue #227's route): ONE call per (image,
 * concept) returns EVERY instance, and clicks only hit-test client-side.
 * The `furniture` catch-all call is therefore fired the moment the
 * editor's image has loaded — it IS the prewarm, and its instances are
 * already on screen before the user reaches for a tool. Chip switches
 * reuse the same machinery for their one-time per-concept fetch; repeats
 * are served from the SegmentCache (zero network).
 *
 * Lifecycle
 * ---------
 * - Fires once per (roomId, imageUrl, imageWidth×imageHeight, concept)
 *   key: the initial editor open, a source switch to a different image,
 *   and the first selection of each concept — but ONLY while `enabled`
 *   authorizes the base (issue #748: a post-completion rebase onto a
 *   staged result keeps the gate closed until the user explicitly
 *   refreshes).
 * - `resolveCached` lets the editor serve an already-cached concept
 *   instantly without touching the network (the hook marks it warm).
 * - Failures are SILENT by design: a failed auto-fire only means the
 *   instances list stays empty; the outcome is still observable via the
 *   `segment_prewarm_timing` console event.
 *
 * Side effects: one fetch per uncached key (aborted on cleanup/unmount)
 * and one `segment_prewarm_timing` console event per attempt.
 */

/** Reason for concept detection failure, used to show appropriate UI. */
export type SegmentPrewarmFailedReason =
  | "service-unreachable" // network/DNS failure
  | "http-error" // 4xx/5xx response
  | "invalid-response"; // response ok but concept not found

/** States of the editor-open concept auto-fire. */
export type SegmentPrewarmStatus = "idle" | "warming" | "warm" | "failed";

interface UseConceptSegmentsArgs {
  /**
   * Master gate — the issue #748 lazy-refresh authorization for the
   * current base image (see lib/segment-refresh-policy.ts): true for the
   * editor-open base, user-driven source switches, and an explicit user
   * refresh; false after a bare post-completion rebase onto a staged
   * result (no billed call until the user asks).
   */
  enabled: boolean;
  roomId: string;
  /** The source image URL the editor is currently editing (null until known). */
  imageUrl: string | null;
  /** Measured natural width of that image (null until it has loaded). */
  imageWidth: number | null;
  /** Measured natural height of that image (null until it has loaded). */
  imageHeight: number | null;
  /** The active detection concept (chips + validated free text). */
  concept: string;
  /**
   * Renders the cached result for a concept WITHOUT a fetch (editor's
   * SegmentCache). Return null for a cache miss.
   */
  resolveCached?: (concept: string) => SegmentCacheEntry | null;
}

export interface UseConceptSegmentsResult {
  status: SegmentPrewarmStatus;
  /** The latest detection result (cache-served or fetched), if any. */
  result: SegmentCacheEntry | null;
  /** The reason for failure, only set when status is "failed". */
  failedReason?: SegmentPrewarmFailedReason;
}

export function useConceptSegments({
  enabled,
  roomId,
  imageUrl,
  imageWidth,
  imageHeight,
  concept,
  resolveCached,
}: UseConceptSegmentsArgs): UseConceptSegmentsResult {
  const [status, setStatus] = useState<SegmentPrewarmStatus>("idle");
  const [result, setResult] = useState<SegmentCacheEntry | null>(null);
  const [failedReason, setFailedReason] = useState<SegmentPrewarmFailedReason | undefined>(undefined);
  // Dedupe guard: the effect re-runs on every render where its deps are
  // re-created; a completed (or in-flight) key must not re-fire.
  const warmedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !imageUrl || !imageWidth || !imageHeight) {
      setStatus("idle");
      setResult(null);
      return;
    }
    const key = `${roomId}|${imageUrl}|${imageWidth}x${imageHeight}|${concept}`;
    const cached = resolveCached?.(concept) ?? null;
    if (cached) {
      warmedKeyRef.current = key;
      setResult(cached);
      setStatus("warm");
      return;
    }
    if (warmedKeyRef.current === key) return;
    warmedKeyRef.current = key;
    setStatus("warming");
    setResult(null);

    const controller = new AbortController();
    const startedAt = performance.now();
    fetch("/api/segment/furnishings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ roomId, imageUrl, concept }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Concept detection failed with HTTP ${response.status}`);
        }
        const data = (await response.json()) as {
          concept?: unknown;
          maskDataUrls?: unknown;
          scores?: unknown;
        };
        const maskDataUrls = Array.isArray(data.maskDataUrls)
          ? data.maskDataUrls.filter((url): url is string => typeof url === "string")
          : [];
        const scores = Array.isArray(data.scores)
          ? data.scores.map((score) =>
              typeof score === "number" && Number.isFinite(score) ? score : 0
            )
          : [];
        return {
          concept: typeof data.concept === "string" ? data.concept : concept,
          maskDataUrls,
          scores,
        };
      })
      .then((entry) => {
        if (controller.signal.aborted) return;
        setResult(entry);
        setStatus("warm");
        emitSegmentTiming(
          buildSegmentPrewarmTimingEvent({
            ms: performance.now() - startedAt,
            ok: true,
            imageUrl,
          })
        );
      })
      .catch((err: unknown) => {
        // Aborts are lifecycle noise (dep change/unmount), not failures.
        if (controller.signal.aborted) return;
        // Determine failure reason
        let reason: SegmentPrewarmFailedReason = "http-error";
        if (err instanceof TypeError && err.message.includes("fetch")) {
          reason = "service-unreachable";
        } else if (err instanceof Error) {
          if (err.message.includes("HTTP 4") || err.message.includes("HTTP 5") || err.message.includes("Concept detection failed")) {
            reason = "http-error";
          }
        }
        setFailedReason(reason);
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
    // resolveCached is excluded: it must not re-trigger fetches; the cache
    // is consulted once per key change, and the editor keeps its identity
    // stable via useCallback anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, roomId, imageUrl, imageWidth, imageHeight, concept]);

  return { status, result, failedReason };
}
