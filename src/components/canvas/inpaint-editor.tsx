"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import InpaintMaskCanvas from "./inpaint-mask-canvas";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { Loader2 } from "lucide-react";
import { useInpaintStatus } from "./use-inpaint-status";
import {
  inpaintSourceLabel,
  inpaintSourcesEqual,
  type InpaintSource,
} from "@/lib/inpaint-source";
import {
  DEFAULT_MASK_EXPANSION_RADIUS,
  MAX_MASK_EXPANSION_RADIUS,
} from "@/lib/mask-dilation";
import HolisticSpikePanel from "./holistic-spike-panel";
import StageEntireRoomPreset from "./stage-entire-room-preset";
import BatchStagingPanel from "./batch-staging-panel";
import { useSegmentPrewarm } from "./use-segment-prewarm";
import { SegmentCache } from "@/lib/segment-cache";
import {
  buildSegmentTimingEvent,
  emitSegmentTiming,
} from "@/lib/segment-timing";
import { SAM_TOOL_ENABLED } from "@/lib/sam-tool";
import {
  MAX_BATCH_OBJECTS,
  advanceBatchProgress,
  buildBatchPlan,
  initialBatchProgress,
  reduceSelectionSet,
  unionMaskBuffers,
  type BatchProgress,
  type BatchPromptMode,
  type BatchSelection,
  type PerObjectBatchPlan,
} from "@/lib/multi-select-batch";

interface InpaintEditorProps {
  roomId: string;
  /** The resolved source image the mask applies to (before photo or staged variant). */
  imageUrl: string;
  aesthetic: string;
  promptDirectives: string;
  /** The "after" slot this run's result will land in (resolved by the parent). */
  variantSlot: 0 | 1;
  /** Currently selected source; the parent owns this state (issue #170). */
  source: InpaintSource;
  /** Available source options (original photo + staged variants). */
  sourceOptions: InpaintSource[];
  onSourceChange?: (source: InpaintSource) => void;
  pendingRequestId?: string | null;
  /** Source of the pending run, reconstructed from its persisted row. */
  pendingSource?: InpaintSource | null;
  onInpaintComplete?: (resultImageUrl: string, source: InpaintSource) => void;
  /**
   * Full-width focused layout (issue #169): the mask canvas spans the
   * available content width instead of the compact card cap.
   */
  fullWidth?: boolean;
}

/** Resolves when the image is loaded; rejects on a load error. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load."));
    img.src = src;
  });
}

/**
 * Scales a selection's mask PNG to the photo's natural pixel dimensions
 * (issue #203): SAM returns masks at the provider's output size, but every
 * dispatched mask must share the source image's geometry (the same
 * invariant the brush flow's export step guarantees). Browser-only; the
 * luminance threshold downstream tolerates resampling blur.
 */
async function normalizeMaskToNaturalDims(
  maskDataUrl: string,
  width: number,
  height: number
): Promise<string | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(await loadImage(maskDataUrl), 0, 0, width, height);
  } catch {
    return null;
  }
  return canvas.toDataURL("image/png");
}

/**
 * OR-composes every selection's mask into one union-mask data URL (issue
 * #203 thematic mode). Decodes each mask at natural dimensions, runs the
 * pure `unionMaskBuffers` composition, and serializes the result.
 * Browser-only.
 */
async function composeUnionMaskDataUrl(
  maskDataUrls: string[],
  width: number,
  height: number
): Promise<string | null> {
  if (maskDataUrls.length === 0) return null;
  const buffers: Array<{
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }> = [];
  for (const url of maskDataUrls) {
    try {
      const img = await loadImage(url);
      const layer = document.createElement("canvas");
      layer.width = width;
      layer.height = height;
      const layerCtx = layer.getContext("2d");
      if (!layerCtx) return null;
      layerCtx.drawImage(img, 0, 0, width, height);
      buffers.push({
        width,
        height,
        data: layerCtx.getImageData(0, 0, width, height).data,
      });
    } catch {
      return null;
    }
  }
  const union = unionMaskBuffers(buffers);
  if (!union) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(union.data), union.width, union.height),
    0,
    0
  );
  return canvas.toDataURL("image/png");
}

export default function InpaintEditor({
  roomId,
  imageUrl,
  aesthetic,
  promptDirectives,
  variantSlot,
  source,
  sourceOptions,
  onSourceChange,
  pendingRequestId,
  pendingSource,
  onInpaintComplete,
  fullWidth = false,
}: InpaintEditorProps) {
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
  // Issue #180: outward mask growth (in mask-canvas pixels) applied before
  // the mask is dispatched, so bezels/frames at the painted boundary are
  // regenerated too. 0 restores the un-dilated mask.
  const [maskExpansion, setMaskExpansion] = useState(DEFAULT_MASK_EXPANSION_RADIUS);
  const { toasts, showError, showSuccess, dismissToast } = useToast();

  // Click-to-segment state (issue #183): one in-flight SAM request at a
  // time. Issue #203: a successful response no longer merges straight onto
  // the canvas — it is added to a pending selection set (the multi-select
  // batch). The editor composes the union of the set and hands it to the
  // canvas as a SelectionReset, so the grid always equals the union.
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [batchSelections, setBatchSelections] = useState<BatchSelection[]>([]);
  const [unionMaskDataUrl, setUnionMaskDataUrl] = useState<string | null>(null);
  const [selectionReset, setSelectionReset] = useState<{
    id: number;
    maskDataUrl: string | null;
  } | null>(null);
  const selectionResetIdRef = useRef(0);
  const selectionIdRef = useRef(0);

  // Issue #203: per-object batch execution state. `activeBatch` holds the
  // running (or failed, awaiting retry) plan + progress; the refs carry
  // run outcomes out of the polling hook (which swallows errors into
  // callbacks) and guard against concurrent batches.
  const [activeBatch, setActiveBatch] = useState<{
    plan: PerObjectBatchPlan;
    progress: BatchProgress;
  } | null>(null);
  const batchActiveRef = useRef(false);
  const batchOutcomeRef = useRef<{ kind: "completed"; url: string } | null>(null);
  const batchFailureRef = useRef<string | null>(null);

  // Issue #202: in-session cache of provider-returned masks. Repeat
  // selections of an already-segmented point (the canvas dedupe resets on
  // paint/fill/clear, so re-selection is a normal flow) come back instantly
  // with zero fal-ai/sam calls. One instance per mount, cleared on source
  // switch — the lifecycle that makes same-URL keying safe is documented in
  // segment-cache.ts.
  const segmentCacheRef = useRef<SegmentCache | null>(null);
  if (!segmentCacheRef.current) {
    segmentCacheRef.current = new SegmentCache();
  }

  // Issue #202: pre-warm the /api/segment path (route cold start + auth +
  // room ownership) while the editor is open, at zero provider cost. The
  // status classifies click timings as cold ("warming"/"idle"/"failed") or
  // warm ("warm") for the latency instrumentation below.
  const prewarmStatus = useSegmentPrewarm({
    enabled: SAM_TOOL_ENABLED,
    roomId,
    imageUrl: imageUrl || null,
    imageWidth: imageDims?.width ?? null,
    imageHeight: imageDims?.height ?? null,
  });

  // The source in effect for the CURRENT run, captured at start time so the
  // completion callback reports the right one even if the selector (or the
  // pending-request props) change while a run is in flight.
  const runSourceRef = useRef<InpaintSource>(pendingSource ?? source);

  // Issue #203: the status hook routes success/failure through these
  // callbacks, and `start()` itself never throws — so batch steps report
  // outcomes through refs. While a per-object batch is active, the generic
  // success toast is suppressed (the batch panel shows per-step progress)
  // and failures are captured for the panel's retry affordance instead of
  // the toast's own single-step retry.
  const { isProcessing, statusText, start } = useInpaintStatus({
    onCompleted: (resultImageUrl) => {
      batchOutcomeRef.current = { kind: "completed", url: resultImageUrl };
      onInpaintComplete?.(resultImageUrl, runSourceRef.current);
    },
    showSuccess: (message) => {
      if (!batchActiveRef.current) showSuccess(message);
    },
    showError: (message, retryable, onRetry, retryLabel) => {
      if (batchActiveRef.current) {
        batchFailureRef.current = message;
        return;
      }
      showError(message, retryable, onRetry, retryLabel);
    },
  });

  // Measure the source photo so the mask canvas can mirror its aspect ratio
  // and export masks at the photo's exact pixel dimensions.
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImageDims({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = imageUrl;
    return () => {
      img.onload = null;
    };
  }, [imageUrl]);

  const aspectRatio = imageDims ? imageDims.width / imageDims.height : null;

  // Resume an in-flight job (e.g. after a refresh): skip the submit and go
  // straight to polling the persisted requestId. The run's source comes from
  // the persisted row so completion persists with the original run's
  // semantics (issue #170).
  useEffect(() => {
    if (!pendingRequestId) return;
    runSourceRef.current = pendingSource ?? source;
    void start(async () => pendingRequestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume once per requestId, matching the pre-#170 behavior
  }, [pendingRequestId, start]);

  // Switching source swaps the image being edited — any existing mask was
  // drawn for the previous image and must not leak into the next run. The
  // segment cache is dropped with it (issue #202 lifecycle: one session
  // per image).
  const handleSourceChange = useCallback(
    (next: InpaintSource) => {
      if (inpaintSourcesEqual(next, source)) return;
      setMaskDataUrl(null);
      // Issue #203: masks (and the selection set that produced them) were
      // segmented against the previous image — they must not leak. The
      // union/reset state follows the selection set via effects.
      setBatchSelections([]);
      segmentCacheRef.current?.clear();
      onSourceChange?.(next);
    },
    [source, onSourceChange]
  );

  // Select Object (issue #183): sends the clicked point (already in the
  // photo's natural pixel space) plus the room reference to /api/segment.
  // On failure the error is surfaced and the canvas is left unchanged — a
  // segment response only reaches the canvas via the selection set on
  // success.
  //
  // Issue #202 additions kept: in-session cache for repeat points, and a
  // `[segment-timing]` event (source: cache|network, prewarmed: cold/warm)
  // per completed selection.
  //
  // Issue #203: consecutive clicks ACCUMULATE — each success adds an
  // object (click point + its own mask, normalized to natural dimensions)
  // to the pending batch selection set, capped at MAX_BATCH_OBJECTS. The
  // union-composition effect below syncs the canvas.
  const handleSegmentSelect = useCallback(
    async (point: { x: number; y: number }) => {
      if (isProcessing || isSegmenting) return;
      if (!imageDims) {
        showError("The image is still loading. Please try again.");
        return;
      }
      if (batchSelections.length >= MAX_BATCH_OBJECTS) {
        showError(
          `Batches are capped at ${MAX_BATCH_OBJECTS} objects — each object is a separate billed generation. Run this batch first, then select more.`
        );
        return;
      }

      const addSelection = async (rawMaskDataUrl: string) => {
        const maskDataUrl = await normalizeMaskToNaturalDims(
          rawMaskDataUrl,
          imageDims.width,
          imageDims.height
        );
        if (!maskDataUrl) {
          showError("Could not prepare the selected object's mask. Please try again.");
          return;
        }
        const selection: BatchSelection = {
          id: `sel-${(selectionIdRef.current += 1)}`,
          point,
          maskDataUrl,
        };
        const reduction = reduceSelectionSet(batchSelections, { type: "add", selection });
        if (reduction.rejected === "cap") {
          showError(
            `Batches are capped at ${MAX_BATCH_OBJECTS} objects. Run this batch first, then select more.`
          );
          return;
        }
        if (reduction.rejected === "duplicate") {
          showError("That object is already in the batch — click a different object.");
          return;
        }
        setBatchSelections(reduction.selections);
      };

      const cache = segmentCacheRef.current;
      const clickStartedAt = performance.now();
      const cachedMask = cache?.get(imageUrl, point) ?? null;
      if (cachedMask) {
        emitSegmentTiming(
          buildSegmentTimingEvent({
            ms: performance.now() - clickStartedAt,
            source: "cache",
            prewarmed: true,
            imageUrl,
          })
        );
        await addSelection(cachedMask);
        return;
      }
      setIsSegmenting(true);
      try {
        const response = await fetch("/api/segment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            imageUrl,
            point,
            imageWidth: imageDims.width,
            imageHeight: imageDims.height,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || "Failed to select the object.");
        }
        cache?.put(imageUrl, point, data.maskDataUrl);
        emitSegmentTiming(
          buildSegmentTimingEvent({
            ms: performance.now() - clickStartedAt,
            source: "network",
            prewarmed: prewarmStatus === "warm",
            imageUrl,
          })
        );
        await addSelection(data.maskDataUrl);
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Object selection failed. Please try again."
        );
      } finally {
        setIsSegmenting(false);
      }
    },
    [isProcessing, isSegmenting, imageDims, roomId, imageUrl, prewarmStatus, showError, batchSelections]
  );

  // Issue #203: keep the union mask (for thematic runs + the batch panel)
  // and the canvas's selection reset in lockstep with the selection set.
  // The reset carries an incrementing id so every change applies exactly
  // once; an empty set resets the grid to black (Clear Mask semantics).
  useEffect(() => {
    if (!imageDims) return;
    let cancelled = false;
    const compose = async () => {
      const unionUrl =
        batchSelections.length > 0
          ? await composeUnionMaskDataUrl(
              batchSelections.map((selection) => selection.maskDataUrl),
              imageDims.width,
              imageDims.height
            )
          : null;
      if (cancelled) return;
      setUnionMaskDataUrl(unionUrl);
      selectionResetIdRef.current += 1;
      setSelectionReset({ id: selectionResetIdRef.current, maskDataUrl: unionUrl });
    };
    void compose();
    return () => {
      cancelled = true;
    };
  }, [batchSelections, imageDims]);

  // Issue #203: a selection-set change invalidates a finished (e.g.
  // failed) batch's plan — drop it so the panel never offers a retry
  // against masks that are no longer selected. Active batches keep theirs.
  useEffect(() => {
    if (!batchActiveRef.current) {
      setActiveBatch(null);
    }
  }, [batchSelections]);

  // Shared submit path for brush runs, holistic spike runs (issue #190),
  // and batch runs (issue #203): all post the same body to /api/inpaint;
  // holistic runs add the negativePrompt override and swap mask/directives
  // for the strategy-generated ones. Batch steps pass `sourceUrl` (the
  // previous step's persisted result) so per-object results stack into the
  // same variant slot; omitted = the editor's current source image.
  const beginInpaintRun = useCallback(
    async (run: {
      maskUrl: string;
      promptDirectives: string;
      negativePrompt?: string;
      sourceUrl?: string;
    }) => {
      if (!imageUrl) {
        showError("No image available to edit.");
        return;
      }

      runSourceRef.current = source;
      // Issue #203: each run reports its outcome through this ref (the
      // status hook swallows errors into callbacks). Reset per run so a
      // stale completion can never be attributed to the next one.
      batchOutcomeRef.current = null;
      batchFailureRef.current = null;

      await start(async (signal) => {
        const startResponse = await fetch("/api/inpaint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageUrl: run.sourceUrl ?? imageUrl,
            maskUrl: run.maskUrl,
            promptDirectives: run.promptDirectives,
            negativePrompt: run.negativePrompt,
            aesthetic,
            roomId,
            variantSlot,
            sourceSlot: source.kind === "variant" ? source.slot : null,
          }),
          signal,
        });

        const startData = await startResponse.json();

        if (!startResponse.ok) {
          throw new Error(startData.message || startData.error || "Failed to start inpainting");
        }

        return startData.requestId as string;
      });
    },
    [imageUrl, aesthetic, roomId, variantSlot, source, start, showError]
  );

  const handleInpaint = useCallback(async () => {
    if (!promptDirectives.trim()) {
      showError("Please provide staging directives first.");
      return;
    }

    if (!maskDataUrl) {
      showError("Please draw a mask on the image first.");
      return;
    }

    await beginInpaintRun({ maskUrl: maskDataUrl, promptDirectives });
  }, [maskDataUrl, promptDirectives, beginInpaintRun, showError]);

  // Holistic spike entry (issue #190): the panel builds the full-room
  // mask + aesthetic-derived directives; this just forwards them into
  // the shared run launcher. The one-click preset (issue #191) reuses
  // the same shape and launcher.
  const handleHolisticRun = useCallback(
    (run: { maskDataUrl: string; promptDirectives: string; negativePrompt: string }) => {
      void beginInpaintRun({
        maskUrl: run.maskDataUrl,
        promptDirectives: run.promptDirectives,
        negativePrompt: run.negativePrompt,
      });
    },
    [beginInpaintRun]
  );

  // Issue #203: sequential per-object batch runner. Steps run ONE AT A
  // TIME through the shared submit path (never parallel — fal queue
  // handling, polling, and persistence stay exactly as-is), each pairing
  // an object's mask with its prompt and writing into the same variant
  // slot. Step N+1 edits step N's persisted result URL, so results stack.
  //
  // Atomicity (deliberately simple): every step is a complete, fully
  // persisted inpaint run. On a failed step the loop stops, keeping
  // earlier steps' results in the variant; the panel offers "Retry
  // remaining", which resumes from the first unfinished step and chains
  // again from the last completed result. No rollbacks, no transactions.
  const runPerObjectBatch = useCallback(
    async (plan: PerObjectBatchPlan, startProgress?: BatchProgress) => {
      if (batchActiveRef.current) return;
      batchActiveRef.current = true;
      let progress = startProgress ?? initialBatchProgress(plan.steps);
      setActiveBatch({ plan, progress });
      let sourceUrl: string | undefined;

      try {
        for (let index = 0; index < plan.steps.length; index++) {
          const step = progress.steps[index];
          if (step.status === "completed") {
            // Retry pass: resume chaining from the last persisted result.
            sourceUrl = step.resultUrl ?? sourceUrl;
            continue;
          }

          progress = advanceBatchProgress(progress, { kind: "start", index });
          setActiveBatch({ plan, progress });

          await beginInpaintRun({
            maskUrl: plan.steps[index].maskDataUrl,
            promptDirectives: plan.steps[index].promptDirectives,
            sourceUrl,
          });

          const outcome = batchOutcomeRef.current;
          if (outcome?.kind === "completed") {
            sourceUrl = outcome.url;
            progress = advanceBatchProgress(progress, {
              kind: "complete",
              index,
              resultUrl: outcome.url,
            });
            setActiveBatch({ plan, progress });
            continue;
          }

          progress = advanceBatchProgress(progress, {
            kind: "fail",
            index,
            message: batchFailureRef.current ?? "Inpainting failed for this object.",
          });
          setActiveBatch({ plan, progress });
          return; // earlier results stay; unfinished steps await retry
        }

        batchActiveRef.current = false;
        setActiveBatch(null);
        setBatchSelections([]);
        showSuccess(
          `Batch complete — ${plan.steps.length} ${
            plan.steps.length === 1 ? "object" : "objects"
          } staged.`
        );
      } finally {
        batchActiveRef.current = false;
      }
    },
    [beginInpaintRun, showSuccess]
  );

  // Issue #203: batch entry point from the panel. Builds the validated
  // plan (pure logic in multi-select-batch.ts), then either runs the
  // thematic single run (union mask + one prompt through the shared
  // launcher) or kicks off the sequential per-object runner.
  const handleBatchRun = useCallback(
    (input: { mode: BatchPromptMode; thematicPrompt: string; perObjectPrompts: string[] }) => {
      const built = buildBatchPlan({
        selections: batchSelections,
        mode: input.mode,
        thematicPrompt: input.thematicPrompt,
        perObjectPrompts: input.perObjectPrompts,
        unionMaskDataUrl,
      });
      if (!built.ok) {
        showError(built.error);
        return;
      }
      const plan = built.plan;
      if (plan.kind === "thematic") {
        void beginInpaintRun({
          maskUrl: plan.maskDataUrl,
          promptDirectives: plan.promptDirectives,
        }).then(() => {
          // A thematic batch is one ordinary run — consume the selection
          // set only when it actually completed (outcome ref is set by
          // onCompleted; beginInpaintRun resets it per run).
          if (batchOutcomeRef.current?.kind === "completed") {
            setBatchSelections([]);
          }
        });
        return;
      }
      void runPerObjectBatch(plan);
    },
    [batchSelections, unionMaskDataUrl, beginInpaintRun, runPerObjectBatch, showError]
  );

  const handleBatchRetry = useCallback(() => {
    if (!activeBatch) return;
    void runPerObjectBatch(activeBatch.plan, activeBatch.progress);
  }, [activeBatch, runPerObjectBatch]);

  const handleRemoveLastSelection = useCallback(() => {
    setBatchSelections((previous) =>
      reduceSelectionSet(previous, { type: "removeLast" }).selections
    );
  }, []);

  const handleClearSelection = useCallback(() => {
    setBatchSelections([]);
  }, []);

  // Clear Mask (canvas button) empties the grid — the selection set must
  // follow so the panel can't describe objects the canvas no longer masks.
  const handleMaskCleared = useCallback(() => {
    setBatchSelections([]);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {sourceOptions.length > 1 && (
        <fieldset className="rounded-md border border-stone-200 p-3">
          <legend className="px-1 text-sm font-medium text-stone-700">
            Edit from
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {sourceOptions.map((option) => (
              <label
                key={inpaintSourceLabel(option)}
                className="inline-flex cursor-pointer items-center gap-2 text-sm text-stone-700"
              >
                <input
                  type="radio"
                  name={`inpaint-source-${roomId}`}
                  value={inpaintSourceLabel(option)}
                  checked={inpaintSourcesEqual(option, source)}
                  disabled={isProcessing}
                  onChange={() => handleSourceChange(option)}
                  className="h-4 w-4 accent-stone-800"
                />
                {inpaintSourceLabel(option)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* Issue #191 one-click preset: primary full-room staging affordance.
          It targets the currently selected variant slot via the shared run
          launcher, so brush touch-ups stack on its result afterwards. */}
      <StageEntireRoomPreset
        aesthetic={aesthetic}
        imageWidth={imageDims?.width ?? null}
        imageHeight={imageDims?.height ?? null}
        disabled={isProcessing || isSegmenting}
        processing={isProcessing}
        statusText={statusText}
        onRun={handleHolisticRun}
        onError={showError}
      />

      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-medium text-stone-700 mb-2">Source Image</h4>
        <InpaintMaskCanvas
          overlayImageSrc={imageUrl}
          aspectRatio={aspectRatio}
          naturalWidth={imageDims?.width ?? null}
          naturalHeight={imageDims?.height ?? null}
          initialMaskDataUrl={maskDataUrl}
          onMaskChange={setMaskDataUrl}
          onSegmentSelect={handleSegmentSelect}
          segmentDisabled={isProcessing || isSegmenting}
          segmenting={isSegmenting}
          expansionRadius={maskExpansion}
          fullWidth={fullWidth}
          selectionMarkers={batchSelections.map((selection, index) => ({
            id: selection.id,
            x: selection.point.x,
            y: selection.point.y,
            index: index + 1,
          }))}
          selectionReset={selectionReset}
          onMaskCleared={handleMaskCleared}
        />

        <label className="flex items-center gap-2 text-sm text-stone-700">
          Mask Expansion:
          <input
            type="range"
            min={0}
            max={MAX_MASK_EXPANSION_RADIUS}
            value={maskExpansion}
            onChange={(e) => setMaskExpansion(Number(e.target.value))}
            aria-describedby="mask-expansion-hint"
            className="w-32"
          />
          <span className="w-10 text-right">{maskExpansion}px</span>
        </label>
        <p id="mask-expansion-hint" className="text-xs text-gray-500">
          Grows the mask outward before submitting so frames, bezels, and
          mounts at the painted edge are replaced too. 0 keeps the mask
          exactly as painted.
        </p>
      </div>

      {/* Issue #203: multi-select batch panel — appears once at least one
          Select Object click has accumulated. Thematic runs go through the
          shared single-run launcher; per-object plans execute sequentially
          with per-step progress and a retry affordance. */}
      {batchSelections.length > 0 && (
        <BatchStagingPanel
          selections={batchSelections}
          maxObjects={MAX_BATCH_OBJECTS}
          disabled={isProcessing || isSegmenting}
          processing={isProcessing}
          activeBatch={activeBatch}
          onRun={handleBatchRun}
          onRetryRemaining={handleBatchRetry}
          onRemoveLast={handleRemoveLastSelection}
          onClearSelection={handleClearSelection}
        />
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={handleInpaint}
          disabled={isProcessing || isSegmenting || !maskDataUrl}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
            transition-colors
            ${isProcessing || isSegmenting || !maskDataUrl
              ? "bg-stone-300 text-stone-500 cursor-not-allowed"
              : "bg-stone-800 text-white hover:bg-stone-700"
            }
          `}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            "Apply Inpainting"
          )}
        </button>

        {isProcessing && statusText && (
          <span className="text-sm text-stone-600">{statusText}</span>
        )}

        {isSegmenting && (
          <span role="status" className="text-sm text-stone-600">
            Identifying the object you clicked...
          </span>
        )}
      </div>

      {/* Issue #190 spike entry — kept as protocol documentation; the
          polished one-click preset above (issue #191) does not depend on it. */}
      <details className="no-print rounded-md border border-dashed border-stone-300 p-3 text-sm">
        <summary className="cursor-pointer select-none text-stone-500">
          Holistic staging spike (#190) — internal testing only
        </summary>
        <div className="pt-3">
          <HolisticSpikePanel
            aesthetic={aesthetic}
            imageWidth={imageDims?.width ?? null}
            imageHeight={imageDims?.height ?? null}
            disabled={isProcessing || isSegmenting}
            onRun={handleHolisticRun}
            onError={showError}
          />
        </div>
      </details>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
