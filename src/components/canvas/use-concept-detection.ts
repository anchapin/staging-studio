"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useConceptSegments } from "./use-segment-prewarm";
import { SegmentCache, type SegmentCacheEntry } from "@/lib/segment-cache";
import {
  armForCurrentBase,
  initialSegmentRefreshState,
  isSegmentDetectionArmed,
  markCompletionRebase,
  markUserSourceNavigation,
  resolveBaseImageChange,
} from "@/lib/segment-refresh-policy";
import {
  buildSelectionLoggedEvent,
  DEFAULT_CONCEPT,
  isValidConceptName,
  normalizeConceptInput,
} from "@/lib/concept-chips";
import { findInstanceAtPoint, instanceSeedPoint } from "@/lib/instance-hit-test";
import { logSelectionEvent } from "@/app/actions/selection-log";
import { computeMaskCanvasDimensions } from "@/lib/canvas-coords";
import { maskBounds } from "@/lib/vision-labels";
import {
  MAX_BATCH_OBJECTS,
  applyConceptSelectAll,
  applyConceptToggle,
  reduceSelectionSet,
  type BatchSelection,
  type ConceptSelectAllCandidate,
  type InstanceMaskGrid,
} from "@/lib/multi-select-batch";
import {
  buildInstanceOverlays,
  buildSelectionMarkers,
} from "@/lib/instance-overlays";
import {
  cropInstanceDataUrl,
  decodeConceptInstances,
  type DecodedInstance,
} from "./mask-composition";

export interface UseConceptDetectionInput {
  roomId: string;
  imageUrl: string;
  /** Natural dimensions of the base photo; null until the image loads. */
  imageDims: { width: number; height: number } | null;
  /** Toast error surface (cap/duplicate refusals). */
  showError: (message: string) => void;
  /**
   * Issue #230: reports the active labeled concept selection — the label
   * when exactly one labeled selection is active, null otherwise.
   */
  onActiveConceptLabelChange?: (label: string | null) => void;
}

/**
 * The concept-detection cluster of the staging editor (issue #691
 * extraction from inpaint-editor.tsx): requested concept + #748 refresh
 * policy, the in-session SegmentCache, decoded instances, the #229
 * selection set (toggles ARE the batch set), per-instance vision labels
 * (#252 D4), and the toggle/select-all/clear handlers — including the
 * `selection_logged` training-corpus writes.
 *
 * Everything here is a verbatim move; see inpaint-editor.tsx for the
 * original comment trail (issues #202/#228/#229/#249/#252/#378/#748).
 */
export function useConceptDetection({
  roomId,
  imageUrl,
  imageDims,
  showError,
  onActiveConceptLabelChange,
}: UseConceptDetectionInput) {
  // Concept-selection state (issue #228): the detection concept drives
  // ONE billed call per (image, concept); clicks only toggle instances
  // client-side. Issue #229: those toggles ARE the batch selection set —
  // they flow into `batchSelections` through the #203 reducer, so the
  // batch panel's structure, cap, and dispatch are unchanged. There is no
  // other selection source (the old per-click SAM path is gone).
  const [requestedConcept, setRequestedConcept] = useState<string>(DEFAULT_CONCEPT);
  // Issue #748: refresh-detection billing policy — detection is armed per
  // base image. Post-completion rebases onto the staged result land LAZY
  // (the billed SAM call fires only on an explicit user refresh). Pure
  // machine in lib/segment-refresh-policy.ts, pinned 1:1 in tests/.
  const [segmentRefresh, setSegmentRefresh] = useState(() =>
    initialSegmentRefreshState(imageUrl)
  );
  const detectionArmed = isSegmentDetectionArmed(segmentRefresh, imageUrl);
  const [displayedResult, setDisplayedResult] = useState<SegmentCacheEntry | null>(null);
  const [decodedInstances, setDecodedInstances] = useState<
    Array<DecodedInstance | null> | null
  >(null);
  const [selectedInstanceIndices, setSelectedInstanceIndices] = useState<number[]>([]);
  const [conceptInput, setConceptInput] = useState("");
  const [conceptInputError, setConceptInputError] = useState<string | null>(null);
  // Issue #249: non-blocking cap notice for "Select all detected" — the
  // control fills the remaining headroom and names what it left out.
  const [selectAllNotice, setSelectAllNotice] = useState<string | null>(null);
  const conceptInputId = useId();
  // Issue #252 D4: per-instance vision labels (parallel to
  // `decodedInstances`; null = unlabeled). Non-blocking: rows render with
  // the concept string until (and unless) labels arrive.
  const [instanceLabels, setInstanceLabels] = useState<Array<string | null> | null>(null);
  // Keys (imageUrl#concept) of detections that cost a billed call — vision
  // labeling fires ONLY for these (cache hits must never bill OpenAI).
  const networkDetectionKeysRef = useRef(new Set<string>());
  // Keys already labeled this session (dedupe across effect re-runs).
  const labeledKeysRef = useRef(new Set<string>());
  const [batchSelections, setBatchSelections] = useState<BatchSelection[]>([]);

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
  // Issue #748: `enabled` is the lazy-refresh gate — the hook only fires
  // for a base the user authorized (editor open, user source switch, or
  // an explicit refresh), never for a bare post-completion rebase.
  const conceptSegments = useConceptSegments({
    enabled: detectionArmed,
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

  // Issue #748: resolve the refresh policy whenever the base image (or
  // the policy state itself) changes. A completion rebase — the parent
  // persists the staged result and switches the editor onto it — lands
  // LAZY: no billed refresh fires, and the stale per-image detection
  // state below is cleared so masks from the previous photo never tint
  // the new base. User-driven source switches arm the new base instead
  // (the #202/#228 auto-fire lifecycle; their own reset lives in
  // resetForUserSourceSwitch below).
  useEffect(() => {
    const outcome = resolveBaseImageChange(segmentRefresh, imageUrl);
    if (outcome.nextState) setSegmentRefresh(outcome.nextState);
    if (!outcome.resetStaleDetection) return;
    setRequestedConcept(DEFAULT_CONCEPT);
    setDisplayedResult(null);
    setDecodedInstances(null);
    setInstanceLabels(null);
    setSelectedInstanceIndices([]);
    setBatchSelections([]);
    setConceptInputError(null);
    setSelectAllNotice(null);
  }, [imageUrl, segmentRefresh]);

  // Install fetched results into the cache so re-selecting the concept
  // later is free (the hook itself never writes the cache). The fetched
  // key is recorded as a BILLED detection — the trigger for optional
  // vision labeling (issue #252 D4); cache hits never get that marker.
  useEffect(() => {
    if (conceptSegments.result) {
      networkDetectionKeysRef.current.add(`${imageUrl}#${conceptSegments.result.concept}`);
      segmentCacheRef.current?.put(
        imageUrl,
        conceptSegments.result.concept,
        conceptSegments.result
      );
    }
  }, [conceptSegments.result, imageUrl]);

  // Issue #252 D4: ONE batched GPT-4o-mini vision request per billed
  // detection names every instance. Non-blocking by design — rows render
  // with the concept string until labels land, and any failure just keeps
  // that fallback (AC-3.2). Labeled results are written back into the
  // segment cache, so cache-served concepts restore labels instantly.
  useEffect(() => {
    if (!roomId || !imageUrl || !imageDims) return;
    if (!displayedResult || !decodedInstances) return;

    // Cache-served labels restore instantly (no network, no billing).
    if (displayedResult.labels) {
      setInstanceLabels(displayedResult.labels);
      return;
    }
    const key = `${imageUrl}#${displayedResult.concept}`;
    if (!networkDetectionKeysRef.current.has(key)) return;
    if (labeledKeysRef.current.has(key)) return;
    labeledKeysRef.current.add(key);

    let cancelled = false;
    void (async () => {
      // crossOrigin=anonymous keeps the crop canvas untainted so
      // toDataURL can rasterize crops (the storage mock and Supabase both
      // send permissive CORS headers; a CORS failure just skips labeling).
      const sourceImg = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = imageUrl;
      });
      if (!sourceImg) return;
      const crops: Array<{ instanceIndex: number; cropDataUrl: string }> = [];
      for (let index = 0; index < decodedInstances.length; index++) {
        const instance = decodedInstances[index];
        if (!instance) continue;
        const bounds = maskBounds(instance.grid, instance.width, instance.height);
        if (!bounds) continue;
        // Grid (mask-canvas) space → natural pixel space for the crop.
        const scaleX = imageDims.width / instance.width;
        const scaleY = imageDims.height / instance.height;
        const naturalBounds = {
          minX: Math.floor(bounds.minX * scaleX),
          minY: Math.floor(bounds.minY * scaleY),
          maxX: Math.ceil(bounds.maxX * scaleX),
          maxY: Math.ceil(bounds.maxY * scaleY),
        };
        const cropDataUrl = await cropInstanceDataUrl(sourceImg, naturalBounds, imageDims);
        if (cancelled) return;
        if (cropDataUrl) crops.push({ instanceIndex: index, cropDataUrl });
      }
      if (cancelled || crops.length === 0) return;
      try {
        const response = await fetch("/api/label-instances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            imageUrl,
            concept: displayedResult.concept,
            crops,
          }),
        });
        if (!response.ok) return;
        const data = (await response.json()) as { labels?: unknown };
        if (!Array.isArray(data.labels)) return;
        const labels: Array<string | null> = new Array(displayedResult.maskDataUrls.length).fill(
          null
        );
        for (const entry of data.labels) {
          if (
            entry &&
            typeof entry === "object" &&
            typeof (entry as { instanceIndex?: unknown }).instanceIndex === "number" &&
            typeof (entry as { label?: unknown }).label === "string"
          ) {
            const index = (entry as { instanceIndex: number }).instanceIndex;
            if (index >= 0 && index < labels.length) labels[index] = (entry as { label: string }).label;
          }
        }
        if (cancelled) return;
        setInstanceLabels(labels);
        segmentCacheRef.current?.put(imageUrl, displayedResult.concept, {
          maskDataUrls: displayedResult.maskDataUrls,
          scores: displayedResult.scores,
          labels,
        });
      } catch {
        // Silent by design: labels are enrichment, the concept fallback stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [displayedResult, decodedInstances, imageUrl, imageDims, roomId]);

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
      // Issue #748: picking a concept on a lazily-detected base IS the
      // explicit refresh — arm before the concept key change fires.
      setSegmentRefresh((state) => armForCurrentBase(state, imageUrl));
      setRequestedConcept(concept);
      setConceptInputError(null);
      setDisplayedResult(segmentCacheRef.current?.get(imageUrl, concept) ?? null);
      setInstanceLabels(null);
      // Toggle state is per-concept (issue #228); the batch set mirrors
      // the toggles (issue #229), so it resets with them.
      setSelectedInstanceIndices([]);
      setBatchSelections([]);
      setSelectAllNotice(null);
    },
    [imageUrl]
  );

  // Free-text concept: normalized (capitals forgiven, issue #249) then
  // validated client-side (mirroring the server's segmentConceptSchema)
  // BEFORE any billed call can be built.
  const handleConceptSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = normalizeConceptInput(conceptInput);
    if (!isValidConceptName(candidate)) {
      setConceptInputError(
        'Use a single lowercase word or short phrase — 1–30 characters, lowercase letters, spaces, and hyphens only (no commas, numbers, or sentences). Try "sofa" or "wall art".'
      );
      return;
    }
    setConceptInput("");
    handleConceptChange(candidate);
  };

  // Issue #748: the explicit refresh affordances. Activating the
  // detection surface on the current base — the Auto detect tab, the
  // Select Regions tool, a concept chip (via handleConceptChange), or
  // the refresh button in the detect panel — authorizes (and fires) the
  // billed SAM call for a base that landed lazy.
  const armDetectionForCurrentBase = useCallback(() => {
    setSegmentRefresh((state) => armForCurrentBase(state, imageUrl));
  }, [imageUrl]);

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

  // Overlay descriptors for the canvas's tinted instance layer. Since
  // issue #252 D2/D4, SELECTED instances tint with their REGION's palette
  // color (all members of a merged region share one color — matching the
  // region's badge and panel chip); detected-only instances keep their
  // score-rank color. Pure derivation in lib/instance-overlays.ts.
  const instanceOverlays = useMemo(() => {
    if (!displayedResult || !decodedInstances) return undefined;
    return buildInstanceOverlays(
      displayedResult,
      decodedInstances,
      batchSelections,
      selectedInstanceIndices
    );
  }, [displayedResult, decodedInstances, selectedInstanceIndices, batchSelections]);

  // Issue #252 D4: numbered canvas badges, one per pending region, positioned
  // at the topmost-leftmost pixel of the region's member union (grid space
  // scaled to natural pixels) so a merged region is anchored on its actual
  // shape rather than any single member's seed point. Pure derivation in
  // lib/instance-overlays.ts.
  const selectionMarkers = useMemo(() => {
    if (!decodedInstances || batchSelections.length === 0) return undefined;
    if (!imageDims) return undefined;
    return buildSelectionMarkers(batchSelections, decodedInstances, imageDims);
  }, [batchSelections, decodedInstances, imageDims]);

  // Instance toggling (issue #228): pure client-side hit-test against the
  // decoded grids — re-clicks and re-toggles never cost a network call.
  // Every toggle emits the training-corpus `selection_logged` event (W3
  // depends on this shape). Issue #229: the toggle also drives the batch
  // selection set — ON routes through the #203 reducer (cap + duplicate
  // rules inherited, no new limit logic) and a refused add leaves the
  // instance untinted, so the panel and the canvas always agree.
  // (The isProcessing guard lives in the editor's wrapper, which owns the
  // run status.)
  const handleInstanceToggle = useCallback(
    (point: { x: number; y: number }) => {
      if (!displayedResult || !decodedInstances) return;
      const hit = findInstanceAtPoint(decodedInstances, point);
      if (hit === null) return;
      const instance = decodedInstances[hit];
      if (!instance) return;
      // Issue #252 D2: proximity merging engages when instance grids are
      // available — toggling a mask within MERGE_PROXIMITY_PX of an
      // existing region's members fuses into that region (one row, one
      // prompt, one billed run; the region mask is recomposed below).
      const instanceGrids = new Map<number, InstanceMaskGrid>();
      decodedInstances.forEach((decoded, index) => {
        if (decoded) {
          instanceGrids.set(index, {
            grid: decoded.grid,
            width: decoded.width,
            height: decoded.height,
          });
        }
      });
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
        !selectedInstanceIndices.includes(hit),
        { instanceGrids }
      );
      if (toggled.rejected === "cap") {
        showError(
          `Batch staging is limited to ${MAX_BATCH_OBJECTS} regions — undo or clear one to add more.`
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
      const selectionEvent = buildSelectionLoggedEvent({
        roomId,
        concept: displayedResult.concept,
        instanceIndex: hit,
        score: instance.score,
      });
      // Durable write for training corpus (issue #238 / W3) — the
      // SelectionLog row is the event of record; the browser console
      // mirror was removed as debug debris (#720).
      logSelectionEvent({
        roomId,
        concept: selectionEvent.concept,
        instanceIndex: selectionEvent.instanceIndex,
        score: selectionEvent.score ?? 0,
        editedLabel: selectionEvent.editedLabel,
      }).catch((err) =>
        console.error("[selection-log] failed to persist:", err)
      );
    },
    [
      displayedResult,
      decodedInstances,
      roomId,
      batchSelections,
      selectedInstanceIndices,
      showError,
    ]
  );

  // "Select all detected" (issue #249): bulk toggle-on over every decoded
  // instance of the active concept, in rank order. Routing through
  // applyConceptSelectAll keeps the cap + duplicate rules as the ONLY
  // limit logic and moves both state pieces in lockstep; each instance
  // this call actually selects emits its own selection_logged event (the
  // same shape a click toggle emits — the corpus wants every selection).
  // When detection found more than MAX_BATCH_OBJECTS, the best-ranked fit
  // is selected and a role=status notice names what was left out.
  // (The isProcessing guard lives in the editor's wrapper, which owns the
  // run status.)
  const handleSelectAllDetected = useCallback(() => {
    if (!displayedResult || !decodedInstances) return;
    const candidates: ConceptSelectAllCandidate[] = [];
    for (let index = 0; index < decodedInstances.length; index++) {
      const instance = decodedInstances[index];
      if (!instance) continue;
      const seed = instanceSeedPoint(instance);
      if (!seed) continue;
      candidates.push({
        instanceIndex: index,
        entry: {
          id: `${displayedResult.concept}:${index}`,
          point: seed,
          maskDataUrl: instance.whiteMaskDataUrl,
          conceptLabel: displayedResult.concept,
        },
        score: instance.score,
        grid: { grid: instance.grid, width: instance.width, height: instance.height },
      });
    }
    const result = applyConceptSelectAll(batchSelections, selectedInstanceIndices, candidates);
    setSelectedInstanceIndices(result.selectedInstanceIndices);
    setBatchSelections(result.selections);
    for (const index of result.addedInstanceIndices) {
      const instance = decodedInstances[index];
      const selectionEvent = buildSelectionLoggedEvent({
        roomId,
        concept: displayedResult.concept,
        instanceIndex: index,
        score: instance?.score ?? null,
      });
      // Durable write for training corpus (issue #238 / W3) — the
      // SelectionLog row is the event of record; the browser console
      // mirror was removed as debug debris (#720).
      logSelectionEvent({
        roomId,
        concept: selectionEvent.concept,
        instanceIndex: selectionEvent.instanceIndex,
        score: selectionEvent.score ?? 0,
        editedLabel: selectionEvent.editedLabel,
      }).catch((err) =>
        console.error("[selection-log] failed to persist:", err)
      );
    }
    setSelectAllNotice(
      result.truncated
        ? `Selected ${result.selections.length} of ${candidates.length} detected — batch staging is limited to ${MAX_BATCH_OBJECTS} regions.`
        : null
    );
  }, [
    displayedResult,
    decodedInstances,
    roomId,
    batchSelections,
    selectedInstanceIndices,
  ]);

  const handleRemoveLastSelection = useCallback(() => {
    setBatchSelections((previous) =>
      reduceSelectionSet(previous, { type: "removeLast" }).selections
    );
  }, []);

  // Issue #448: remove a specific selection by id
  const handleRemoveSelection = useCallback((id: string) => {
    setBatchSelections((previous) =>
      reduceSelectionSet(previous, { type: "remove", id }).selections
    );
  }, []);

  const handleClearSelection = useCallback(() => {
    // Issue #249: the canvas's selected-instance tints follow the set —
    // a clear must empty BOTH pieces or solid-filled instances would
    // outlive the panel that ran them.
    setBatchSelections([]);
    setSelectedInstanceIndices([]);
    setSelectAllNotice(null);
  }, []);

  // Clear Mask (canvas button) empties the grid — the selection state must
  // follow so nothing describes objects the canvas no longer masks.
  const handleMaskCleared = useCallback(() => {
    setBatchSelections([]);
    setSelectedInstanceIndices([]);
  }, []);

  // Issue #249: bulk-affordance enablement. `detectedCount` is the active
  // concept's decodable instances; `selectionCount` is whichever state
  // piece is ahead (they move in lockstep — the max guards a transient
  // render between the two setState calls).
  const detectedCount = decodedInstances?.filter(Boolean).length ?? 0;
  const selectionCount = Math.max(batchSelections.length, selectedInstanceIndices.length);

  // User-driven source switch (or its undo): drop the per-image session
  // entirely — segment cache, detection state, selection set — and ARM
  // the new base for the #202/#228 auto-fire (issue #748).
  const resetForUserSourceSwitch = useCallback(() => {
    setBatchSelections([]);
    setInstanceLabels(null);
    segmentCacheRef.current?.clear();
    setRequestedConcept(DEFAULT_CONCEPT);
    setDisplayedResult(null);
    setDecodedInstances(null);
    setSelectedInstanceIndices([]);
    setConceptInputError(null);
    setSelectAllNotice(null);
    // Issue #748: a USER-driven source switch pre-authorizes detection
    // for the base the parent is about to resolve (#202/#228 auto-fire).
    setSegmentRefresh(markUserSourceNavigation);
  }, []);

  // Issue #748: a completed run rebases the editor onto the staged
  // result — mark the rebase so the new base lands LAZY (no billed
  // refresh detection; only an explicit user refresh fires).
  const markRunCompletionRebase = useCallback(() => {
    setSegmentRefresh(markCompletionRebase);
  }, []);

  return {
    // detection state
    detectionArmed,
    requestedConcept,
    conceptSegments,
    conceptLoading,
    displayedResult,
    decodedInstances,
    conceptInput,
    setConceptInput,
    conceptInputError,
    setConceptInputError,
    conceptInputId,
    selectAllNotice,
    instanceLabels,
    // selection set (issue #229: shared with the batch-run cluster)
    batchSelections,
    setBatchSelections,
    setSelectedInstanceIndices,
    detectedCount,
    selectionCount,
    // canvas overlays
    instanceOverlays,
    selectionMarkers,
    // handlers
    handleConceptChange,
    handleConceptSubmit,
    armDetectionForCurrentBase,
    handleInstanceToggle,
    handleSelectAllDetected,
    handleRemoveLastSelection,
    handleRemoveSelection,
    handleClearSelection,
    handleMaskCleared,
    // lifecycle
    resetForUserSourceSwitch,
    markRunCompletionRebase,
  };
}

export type UseConceptDetectionResult = ReturnType<typeof useConceptDetection>;
