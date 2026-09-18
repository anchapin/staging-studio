"use client";

import { useState, useCallback, useEffect, useRef, useMemo, useId } from "react";
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
import { useConceptSegments } from "./use-segment-prewarm";
import { SegmentCache, type SegmentCacheEntry } from "@/lib/segment-cache";
import { SAM_TOOL_ENABLED } from "@/lib/sam-tool";
import {
  buildConceptEmptyMessage,
  buildSelectionLoggedEvent,
  CONCEPT_CHIPS,
  CONCEPT_EVENT_LOG_PREFIX,
  DEFAULT_CONCEPT,
  isValidConceptName,
} from "@/lib/concept-chips";
import { findInstanceAtPoint } from "@/lib/instance-hit-test";
import {
  maskGridFromProviderPixels,
  paintMaskPixels,
} from "@/lib/mask-format";
import { computeMaskCanvasDimensions } from "@/lib/canvas-coords";
import {
  MAX_BATCH_OBJECTS,
  advanceBatchProgress,
  applyConceptToggle,
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
   * Issue #230: reports the active labeled concept selection — the label
   * when exactly one labeled selection is active, null otherwise. The
   * parent uses it to pre-fill the single-object staging directives
   * ("Replace the {concept} with ") without ever clobbering typed text.
   */
  onActiveConceptLabelChange?: (label: string | null) => void;
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

// -------------------------------------------------------------------------
// Issue #228: SAM 3.1 concept-instance decoding. The detection route
// returns per-instance masks whose provider format varies — live captures
// (issue #248) show grayscale white-on-black PNGs with NO alpha channel,
// while #228 assumed alpha cutouts — so grid extraction goes through the
// format-agnostic classifier and the toggle path rebuilds each mask as
// white-on-black from that classification (the same derived-alpha
// technique every SAM-mask consumer now shares).
// -------------------------------------------------------------------------

/** One decoded detection instance, in response order (score-ranked). */
interface DecodedInstance {
  grid: Uint8Array;
  width: number;
  height: number;
  /** Provider confidence, or null when the response omitted it. */
  score: number | null;
  /** White-on-black mask at the photo's natural dimensions (toggle path). */
  whiteMaskDataUrl: string;
}

/**
 * Decodes one provider mask (grayscale or alpha-cutout — the classifier
 * detects the format) into a hit-test grid (at `gridDims`, the
 * mask-canvas resolution — click points arrive in that space) plus a
 * white-on-black data URL at the photo's natural dimensions. Returns
 * null when the image fails to decode; the caller preserves the slot so
 * response indices stay stable. Browser-only.
 */
async function decodeConceptInstance(
  maskDataUrl: string,
  score: number | null,
  gridDims: { width: number; height: number },
  naturalDims: { width: number; height: number }
): Promise<DecodedInstance | null> {
  try {
    const img = await loadImage(maskDataUrl);

    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = gridDims.width;
    gridCanvas.height = gridDims.height;
    const gridCtx = gridCanvas.getContext("2d");
    if (!gridCtx) return null;
    gridCtx.drawImage(img, 0, 0, gridDims.width, gridDims.height);
    const gridPixels = gridCtx.getImageData(0, 0, gridDims.width, gridDims.height);

    const whiteCanvas = document.createElement("canvas");
    whiteCanvas.width = naturalDims.width;
    whiteCanvas.height = naturalDims.height;
    const whiteCtx = whiteCanvas.getContext("2d");
    if (!whiteCtx) return null;
    whiteCtx.drawImage(img, 0, 0, naturalDims.width, naturalDims.height);
    const painted = paintMaskPixels(
      whiteCtx.getImageData(0, 0, naturalDims.width, naturalDims.height).data,
      naturalDims.width,
      naturalDims.height,
      { maskedColor: [255, 255, 255] }
    );
    whiteCtx.putImageData(
      new ImageData(new Uint8ClampedArray(painted), naturalDims.width, naturalDims.height),
      0,
      0
    );

    return {
      grid: maskGridFromProviderPixels(
        gridPixels.data,
        gridDims.width,
        gridDims.height
      ),
      width: gridDims.width,
      height: gridDims.height,
      score,
      whiteMaskDataUrl: whiteCanvas.toDataURL("image/png"),
    };
  } catch {
    return null;
  }
}

/**
 * Decodes every instance of a concept result, preserving response order
 * (and null slots for undecodable masks) so `selection_logged` indices
 * keep matching the provider response. Browser-only.
 */
async function decodeConceptInstances(
  result: { maskDataUrls: string[]; scores: number[] },
  gridDims: { width: number; height: number },
  naturalDims: { width: number; height: number }
): Promise<Array<DecodedInstance | null>> {
  return Promise.all(
    result.maskDataUrls.map((maskDataUrl, index) =>
      decodeConceptInstance(maskDataUrl, result.scores[index] ?? null, gridDims, naturalDims)
    )
  );
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
  onActiveConceptLabelChange,
  fullWidth = false,
}: InpaintEditorProps) {
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
  // Issue #180: outward mask growth (in mask-canvas pixels) applied before
  // the mask is dispatched, so bezels/frames at the painted boundary are
  // regenerated too. 0 restores the un-dilated mask.
  const [maskExpansion, setMaskExpansion] = useState(DEFAULT_MASK_EXPANSION_RADIUS);
  const { toasts, showError, showSuccess, dismissToast } = useToast();

  // Concept-selection state (issue #228): the detection concept drives
  // ONE billed call per (image, concept); clicks only toggle instances
  // client-side. Issue #229: those toggles ARE the batch selection set —
  // they flow into `batchSelections` through the #203 reducer, so the
  // batch panel's structure, cap, and dispatch are unchanged. There is no
  // other selection source (the old per-click SAM path is gone).
  const [requestedConcept, setRequestedConcept] = useState<string>(DEFAULT_CONCEPT);
  const [displayedResult, setDisplayedResult] = useState<SegmentCacheEntry | null>(null);
  const [decodedInstances, setDecodedInstances] = useState<
    Array<DecodedInstance | null> | null
  >(null);
  const [selectedInstanceIndices, setSelectedInstanceIndices] = useState<number[]>([]);
  const [conceptInput, setConceptInput] = useState("");
  const [conceptInputError, setConceptInputError] = useState<string | null>(null);
  const conceptInputId = useId();
  const [batchSelections, setBatchSelections] = useState<BatchSelection[]>([]);
  const [unionMaskDataUrl, setUnionMaskDataUrl] = useState<string | null>(null);
  const [selectionReset, setSelectionReset] = useState<{
    id: number;
    maskDataUrl: string | null;
  } | null>(null);
  const selectionResetIdRef = useRef(0);

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

  // Issue #230: the single-object editor path (brush → staging
  // directives → Apply Inpainting) pre-fills the parent's directives
  // when a labeled selection is active. Exactly one labeled selection
  // names the mask unambiguously; with zero or several selections the
  // single-object prompt stays untouched (the batch panel owns those
  // flows). Fired through a ref so the effect keys on the label alone —
  // the parent's inline handler identity may churn every render.
  const activeConceptLabel =
    batchSelections.length === 1 ? batchSelections[0].conceptLabel ?? null : null;
  const activeConceptLabelCallbackRef = useRef(onActiveConceptLabelChange);
  useEffect(() => {
    activeConceptLabelCallbackRef.current = onActiveConceptLabelChange;
  });
  useEffect(() => {
    activeConceptLabelCallbackRef.current?.(activeConceptLabel);
  }, [activeConceptLabel]);

  // Issue #228 (rekeying the issue #202 point cache): in-session cache of
  // concept detections. Repeat selections of an already-detected (image,
  // concept) pair — chip re-clicks, toggles after a Clear Mask, returning
  // from another concept — come back instantly with zero billed calls.
  // One instance per mount, cleared on source switch — the lifecycle that
  // makes same-URL keying safe is documented in segment-cache.ts.
  const segmentCacheRef = useRef<SegmentCache | null>(null);
  if (!segmentCacheRef.current) {
    segmentCacheRef.current = new SegmentCache();
  }

  // Issue #228: auto-fire the `furniture` catch-all detection the moment
  // the editor's image has loaded — the real call IS the prewarm (the old
  // `warm: true` ping is gone; one call per (image, concept) returns every
  // instance, so there is nothing cheaper to warm with). Chip switches
  // reuse this machinery; the SegmentCache serves repeats without a fetch.
  const conceptSegments = useConceptSegments({
    enabled: SAM_TOOL_ENABLED,
    roomId,
    imageUrl: imageUrl || null,
    imageWidth: imageDims?.width ?? null,
    imageHeight: imageDims?.height ?? null,
    concept: requestedConcept,
    resolveCached: useCallback(
      (concept: string) => segmentCacheRef.current?.peek(imageUrl, concept) ?? null,
      [imageUrl]
    ),
  });
  const conceptLoading = conceptSegments.status === "warming";

  // Install fetched results into the cache so re-selecting the concept
  // later is free (the hook itself never writes the cache).
  useEffect(() => {
    if (conceptSegments.result) {
      segmentCacheRef.current?.put(
        imageUrl,
        conceptSegments.result.concept,
        conceptSegments.result
      );
    }
  }, [conceptSegments.result, imageUrl]);

  // Surface hook results for the active concept (cache-served or fetched).
  useEffect(() => {
    if (conceptSegments.result && conceptSegments.result.concept === requestedConcept) {
      setDisplayedResult(conceptSegments.result);
    }
  }, [conceptSegments.result, requestedConcept]);

  // Concept switching: serve the cache instantly (zero flicker, zero
  // network) and reset the per-concept toggle state. Uncached concepts
  // fall through to the hook's fetch above.
  const handleConceptChange = useCallback(
    (concept: string) => {
      setRequestedConcept(concept);
      setConceptInputError(null);
      setDisplayedResult(segmentCacheRef.current?.get(imageUrl, concept) ?? null);
      // Toggle state is per-concept (issue #228); the batch set mirrors
      // the toggles (issue #229), so it resets with them.
      setSelectedInstanceIndices([]);
      setBatchSelections([]);
    },
    [imageUrl]
  );

  // Free-text concept: validated client-side (mirroring the server's
  // segmentConceptSchema) BEFORE any billed call can be built.
  const handleConceptSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = conceptInput.trim();
    if (!isValidConceptName(candidate)) {
      setConceptInputError(
        'Use a single lowercase word or short phrase — 1–30 characters, lowercase letters, spaces, and hyphens only (no commas, numbers, or sentences). Try "sofa" or "wall art".'
      );
      return;
    }
    setConceptInput("");
    handleConceptChange(candidate);
  };

  // Decode the displayed result's alpha cutouts into hit-test grids (at
  // the mask-canvas resolution — click points arrive in that space) plus
  // white-on-black masks for the toggle path. Undecodable masks keep
  // their (null) slot so response indices stay stable.
  useEffect(() => {
    if (!displayedResult || displayedResult.maskDataUrls.length === 0 || !imageDims) {
      setDecodedInstances(null);
      return;
    }
    let cancelled = false;
    const gridDims = computeMaskCanvasDimensions(imageDims.width / imageDims.height);
    void decodeConceptInstances(displayedResult, gridDims, imageDims).then((instances) => {
      if (!cancelled) setDecodedInstances(instances);
    });
    return () => {
      cancelled = true;
    };
  }, [displayedResult, imageDims]);

  // Overlay descriptors for the canvas's tinted instance layer.
  const instanceOverlays = useMemo(() => {
    if (!displayedResult || !decodedInstances) return undefined;
    const overlays: Array<{ id: string; maskDataUrl: string; rank: number; selected: boolean }> = [];
    for (let index = 0; index < displayedResult.maskDataUrls.length; index++) {
      const instance = decodedInstances[index];
      if (!instance) continue;
      overlays.push({
        id: `${displayedResult.concept}:${index}`,
        maskDataUrl: displayedResult.maskDataUrls[index],
        rank: index,
        selected: selectedInstanceIndices.includes(index),
      });
    }
    return overlays;
  }, [displayedResult, decodedInstances, selectedInstanceIndices]);

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

  // Instance toggling (issue #228): pure client-side hit-test against the
  // decoded grids — re-clicks and re-toggles never cost a network call.
  // Every toggle emits the training-corpus `selection_logged` event (W3
  // depends on this shape). Issue #229: the toggle also drives the batch
  // selection set — ON routes through the #203 reducer (cap + duplicate
  // rules inherited, no new limit logic) and a refused add leaves the
  // instance untinted, so the panel and the canvas always agree.
  const handleInstanceToggle = useCallback(
    (point: { x: number; y: number }) => {
      if (isProcessing) return;
      if (!displayedResult || !decodedInstances) return;
      const hit = findInstanceAtPoint(decodedInstances, point);
      if (hit === null) return;
      const instance = decodedInstances[hit];
      if (!instance) return;
      const toggled = applyConceptToggle(
        batchSelections,
        selectedInstanceIndices,
        {
          id: `${displayedResult.concept}:${hit}`,
          point,
          maskDataUrl: instance.whiteMaskDataUrl,
          conceptLabel: displayedResult.concept,
        },
        hit,
        !selectedInstanceIndices.includes(hit)
      );
      if (toggled.rejected === "cap") {
        showError(
          `Batch staging is limited to ${MAX_BATCH_OBJECTS} objects — undo or clear one to add more.`
        );
        return;
      }
      if (toggled.rejected === "duplicate") {
        showError(
          "That spot rounds to an already-selected object's click point — toggle that one off first."
        );
        return;
      }
      setSelectedInstanceIndices(toggled.selectedInstanceIndices);
      setBatchSelections(toggled.selections);
      console.log(
        `${CONCEPT_EVENT_LOG_PREFIX} ${JSON.stringify(
          buildSelectionLoggedEvent({
            roomId,
            concept: displayedResult.concept,
            instanceIndex: hit,
            score: instance.score,
          })
        )}`
      );
    },
    [
      isProcessing,
      displayedResult,
      decodedInstances,
      roomId,
      batchSelections,
      selectedInstanceIndices,
      showError,
    ]
  );

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
  // segment cache is dropped with it (issue #202/#228 lifecycle: one
  // session per image), and the concept session resets to the default.
  const handleSourceChange = useCallback(
    (next: InpaintSource) => {
      if (inpaintSourcesEqual(next, source)) return;
      setMaskDataUrl(null);
      // Issue #203: masks (and the selection set that produced them) were
      // segmented against the previous image — they must not leak. The
      // union/reset state follows the selection set via effects.
      setBatchSelections([]);
      segmentCacheRef.current?.clear();
      setRequestedConcept(DEFAULT_CONCEPT);
      setDisplayedResult(null);
      setDecodedInstances(null);
      setSelectedInstanceIndices([]);
      setConceptInputError(null);
      onSourceChange?.(next);
    },
    [source, onSourceChange]
  );

  // Issue #203 (simplified by #229): keep the union mask (for thematic
  // runs + the batch panel) and the canvas's selection reset in lockstep
  // with the batch selection set — since #229 the toggled concept
  // instances ARE that set, so one source drives everything. The reset
  // carries an incrementing id so every change applies exactly once; an
  // empty set resets the grid to black (Clear Mask semantics). Concept
  // masks arrive as white-on-black data URLs at the photo's natural
  // dimensions, the same geometry the batch set is normalized to, so
  // `composeUnionMaskDataUrl` takes them unchanged.
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
        setSelectedInstanceIndices([]);
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
          // onCompleted; beginInpaintRun resets it per run). The tinted
          // instance indices follow the set (issue #229 lockstep).
          if (batchOutcomeRef.current?.kind === "completed") {
            setBatchSelections([]);
            setSelectedInstanceIndices([]);
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

  // Clear Mask (canvas button) empties the grid — the selection state must
  // follow so nothing describes objects the canvas no longer masks.
  const handleMaskCleared = useCallback(() => {
    setBatchSelections([]);
    setSelectedInstanceIndices([]);
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

      <div className="flex flex-col gap-3">
        {/* Issue #228: concept chips + validated free text. Chips enforce
            single-concept by construction; free text is validated with
            isValidConceptName (the server schema's client mirror) BEFORE
            any billed call is built. Flag-gated with the tool itself. */}
        {SAM_TOOL_ENABLED && (
          <div className="flex flex-col gap-2">
            <div
              role="group"
              aria-label="Detection concept"
              aria-busy={conceptLoading}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-sm font-medium text-stone-700">Concept:</span>
              {CONCEPT_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  aria-pressed={requestedConcept === chip}
                  disabled={isProcessing}
                  onClick={() => handleConceptChange(chip)}
                  className={
                    requestedConcept === chip
                      ? "px-2.5 py-1 text-xs rounded-full border border-stone-800 bg-stone-800 text-white hover:bg-stone-700 transition-colors"
                      : "px-2.5 py-1 text-xs rounded-full border border-gray-300 bg-white text-stone-700 hover:bg-gray-50 transition-colors"
                  }
                >
                  {chip}
                </button>
              ))}
            </div>
            <form onSubmit={handleConceptSubmit} className="flex flex-wrap items-center gap-2">
              <label htmlFor={conceptInputId} className="text-xs text-stone-600">
                Custom concept:
              </label>
              <input
                id={conceptInputId}
                type="text"
                value={conceptInput}
                onChange={(event) => {
                  setConceptInput(event.target.value);
                  if (conceptInputError) setConceptInputError(null);
                }}
                placeholder="e.g. wall art"
                className="w-44 rounded-md border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-stone-500"
              />
              <button
                type="submit"
                disabled={isProcessing}
                className="px-2.5 py-1 text-xs rounded-md border border-stone-800 bg-white text-stone-800 hover:bg-stone-100 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                Detect
              </button>
            </form>
            {conceptInputError && (
              <p role="alert" className="text-xs font-medium text-red-700">
                {conceptInputError}
              </p>
            )}
            {conceptLoading && (
              <p role="status" className="text-xs text-stone-600">
                Looking for {requestedConcept}…
              </p>
            )}
            {!conceptLoading && conceptSegments.status === "failed" && (
              <p role="status" className="text-xs font-medium text-amber-700">
                Couldn&apos;t detect &quot;{requestedConcept}&quot; — try again, another
                concept, or the brush.
              </p>
            )}
            {!conceptLoading &&
              displayedResult &&
              displayedResult.concept === requestedConcept &&
              displayedResult.maskDataUrls.length === 0 && (
                <p role="status" className="text-xs text-stone-600">
                  {buildConceptEmptyMessage(requestedConcept)}
                </p>
              )}
          </div>
        )}
        <h4 className="text-sm font-medium text-stone-700 mb-2">Source Image</h4>
        <InpaintMaskCanvas
          overlayImageSrc={imageUrl}
          aspectRatio={aspectRatio}
          naturalWidth={imageDims?.width ?? null}
          naturalHeight={imageDims?.height ?? null}
          initialMaskDataUrl={maskDataUrl}
          onMaskChange={setMaskDataUrl}
          onInstanceToggle={handleInstanceToggle}
          segmentDisabled={isProcessing || conceptLoading}
          segmenting={conceptLoading}
          instanceOverlays={instanceOverlays}
          expansionRadius={maskExpansion}
          fullWidth={fullWidth}
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

      {/* Issue #203 panel, fed since #229 by the concept toggles: appears
          once at least one detected instance has been toggled in. Thematic
          runs go through the shared single-run launcher; per-object plans
          execute sequentially with per-step progress and a retry
          affordance. */}
      {batchSelections.length > 0 && (
        <BatchStagingPanel
          selections={batchSelections}
          maxObjects={MAX_BATCH_OBJECTS}
          disabled={isProcessing || conceptLoading}
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
          disabled={isProcessing || conceptLoading || !maskDataUrl}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
            transition-colors
            ${isProcessing || conceptLoading || !maskDataUrl
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
      </div>

      {/* Issue #191/#223 one-click preset, demoted to an optional shortcut
          by issue #223: the brush → Apply Inpainting flow above is the
          primary path and works on any source without running the preset
          first. The preset detects furnishings and restages only those
          regions (see stage-entire-room-preset.tsx). */}
      <StageEntireRoomPreset
        roomId={roomId}
        imageUrl={imageUrl}
        aesthetic={aesthetic}
        imageWidth={imageDims?.width ?? null}
        imageHeight={imageDims?.height ?? null}
        disabled={isProcessing || conceptLoading}
        processing={isProcessing}
        statusText={statusText}
        onRun={handleHolisticRun}
        onError={showError}
      />

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
            disabled={isProcessing || conceptLoading}
            onRun={handleHolisticRun}
            onError={showError}
          />
        </div>
      </details>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
