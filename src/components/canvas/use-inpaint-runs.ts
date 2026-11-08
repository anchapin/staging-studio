"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useInpaintStatus } from "./use-inpaint-status";
import { InpaintJobLostError } from "@/lib/inpaint-retry";
import {
  shouldPersistResult,
  INPAINT_NOT_PERSISTED_WARNING,
} from "@/lib/inpaint-completion";
import { mergeDirectives } from "@/lib/prompts";
import { type InpaintSource } from "@/lib/inpaint-source";
import {
  advanceBatchProgress,
  buildBatchPlan,
  initialBatchProgress,
  type BatchProgress,
  type BatchPromptMode,
  type BatchSelection,
  type PerObjectBatchPlan,
} from "@/lib/multi-select-batch";
import { type DeclutterIntensity } from "@/lib/holistic-prompt";
import { generateThumbnailFromUrl } from "@/lib/inpaint-thumbnail";
import { measureSceneConservation } from "@/lib/edit-conservation-measure";
import { prepareMaskForDispatch } from "@/lib/mask-dispatch-prepare";
import { saveInpaintVersion } from "@/app/actions/inpaint-versions";

/** Issue #1362b (Stage B): AI guidance parameters shared by every
 * run path. Renamed from the legacy #558 shape — `promptStrength`
 * is now `strength` (DashScope wire name) and `maskBlur` /
 * `creativeMode` / `lockSeed` are gone (mask feathering moved to a
 * browser-side pre-upload pass; creativeMode/lockSeed had no
 * surviving UI control after #1362a's adherence + shadows
 * removal). Only `strength` + `seed` reach the provider. */
export interface InpaintRunGuidance {
  /** DashScope `parameters.strength` (0..1). */
  strength: number;
  /** DashScope `parameters.seed` (0..999999, optional). */
  seed: number | undefined;
}

export interface UseInpaintRunsInput {
  roomId: string;
  variantSlot: 0 | 1;
  imageUrl: string;
  aesthetic: string;
  promptDirectives: string;
  globalDirectives: string;
  /** The resolved source this editor edits; captured per run. */
  source: InpaintSource;
  /** In-flight job to resume after a refresh (issue #170). */
  pendingRequestId?: string | null;
  pendingSource?: InpaintSource | null;
  guidance: InpaintRunGuidance;
  showError: (
    message: string,
    retryable?: boolean,
    onRetry?: () => void,
    retryLabel?: string
  ) => void;
  showSuccess: (message: string) => void;
  onInpaintComplete?: (resultImageUrl: string, source: InpaintSource) => void;
  /** Editor-side active-result tracking (issue #561 version history). */
  setActiveResultUrl: (url: string) => void;
  /** Issue #748: mark the completion rebase so the new base lands lazy. */
  markRunCompletionRebase: () => void;
  /** Selection set + union mask feeding the batch entry points. */
  batchSelections: BatchSelection[];
  unionMaskDataUrl: string | null;
  setBatchSelections: React.Dispatch<React.SetStateAction<BatchSelection[]>>;
  setSelectedInstanceIndices: React.Dispatch<React.SetStateAction<number[]>>;
}

/**
 * The inpaint run cluster (issue #691 extraction from inpaint-editor.tsx):
 * the status-hook wiring (with batch-aware toast routing), the shared
 * submit path used by brush runs, holistic spike runs (#190) and batch
 * runs (#203), and the sequential per-object batch runner with its retry
 * affordance.
 *
 * Everything here is a verbatim move; see inpaint-editor.tsx for the
 * original comment trail (issues #170/#203/#558/#561/#562/#687/#748).
 */
export function useInpaintRuns({
  roomId,
  variantSlot,
  imageUrl,
  aesthetic,
  promptDirectives,
  globalDirectives,
  source,
  pendingRequestId,
  pendingSource,
  guidance,
  showError,
  showSuccess,
  onInpaintComplete,
  setActiveResultUrl,
  markRunCompletionRebase,
  batchSelections,
  unionMaskDataUrl,
  setBatchSelections,
  setSelectedInstanceIndices,
}: UseInpaintRunsInput) {
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

  // The source in effect for the CURRENT run, captured at start time so the
  // completion callback reports the right one even if the selector (or the
  // pending-request props) change while a run is in flight.
  const runSourceRef = useRef<InpaintSource>(pendingSource ?? source);

  // Issue #1446: the pre-edit frame and the edit mask of the CURRENT run,
  // captured at submit time. The staged-output QA (the ABACUS-style
  // scene-conservation check) needs both to measure how much of the frame
  // changed OUTSIDE the mask — and the editor rebases onto the result
  // right after the completion, so they cannot be read from props later.
  const runMeasurementRef = useRef<{
    sourceUrl: string;
    maskUrl: string;
  } | null>(null);

  /**
   * Issue #1446: run the ABACUS-style edit QA for a completed edit.
   *
   * The browser owns the pixel measurement (the server has no pixel
   * access to the staged images), so the pre-edit frame, the staged
   * result and the run's mask are measured here and posted to the QA
   * endpoint, which returns advisory warnings.
   *
   * ADVISORY ONLY: a measurement failure (image not loadable, no mask,
   * no request id) is an explicit no-op, and the returned warnings are
   * logged — never acted on. The edit's outcome never depends on them.
   */
  const reportEditConservation = useCallback(
    async (resultImageUrl: string, requestId?: string) => {
      const measurement = runMeasurementRef.current;
      if (!requestId || !measurement) return;
      try {
        const measurements = await measureSceneConservation({
          referenceUrl: measurement.sourceUrl,
          candidateUrl: resultImageUrl,
          maskDataUrl: measurement.maskUrl,
        });
        // No measurement ⇒ no data ⇒ nothing to check (explicit no-op).
        if (!measurements) return;

        const response = await fetch(
          `/api/inpaint/${encodeURIComponent(requestId)}/conservation`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              regions: {
                before: measurements.before,
                after: measurements.after,
              },
              mask: measurements.mask,
            }),
          }
        );
        if (!response.ok) return;
        const body = (await response.json()) as { qualityWarnings?: string[] };
        const warnings = Array.isArray(body.qualityWarnings)
          ? body.qualityWarnings
          : [];
        if (warnings.length > 0) {
          console.warn(
            JSON.stringify({
              event: "edit_conservation_advisory",
              requestId,
              warnings,
            })
          );
        }
      } catch {
        // Advisory only: a broken QA path must never surface as a failed
        // edit. The completion already happened — nothing to undo here.
      }
    },
    []
  );

  // Issue #203: the status hook routes success/failure through these
  // callbacks, and `start()` itself never throws — so batch steps report
  // outcomes through refs. While a per-object batch is active, the generic
  // success toast is suppressed (the batch panel shows per-step progress)
  // and failures are captured for the panel's retry affordance instead of
  // the toast's own single-step retry.
  const { isProcessing, statusText, start, retryPoll } = useInpaintStatus({
    onCompleted: (resultImageUrl, persisted, requestId) => {
      // Issue #687: `persisted: false` means the completion carries an
      // expiring fal CDN URL — never write it into the room variant slot
      // (onInpaintComplete) or an InpaintVersion row (saveInpaintVersion);
      // both would rot when the link dies. Warn instead: single runs get a
      // persistent error toast, batch steps route the message to the
      // panel's failure affordance (the toast path is suppressed in batch
      // mode, mirroring showError below).
      const persistDecision = shouldPersistResult({ imageUrl: resultImageUrl, persisted });
      if (!persistDecision.persist) {
        batchFailureRef.current = INPAINT_NOT_PERSISTED_WARNING;
        if (!batchActiveRef.current) {
          showError(INPAINT_NOT_PERSISTED_WARNING, true, retryPoll, "Retry save");
        }
        return;
      }
      batchOutcomeRef.current = { kind: "completed", url: resultImageUrl };
      // Update the active result URL for the version history panel (issue #561)
      setActiveResultUrl(resultImageUrl);
      // Issue #748: the parent is about to rebase this editor onto the
      // staged result — mark the rebase so the new base lands LAZY (no
      // billed refresh detection; only an explicit user refresh fires).
      markRunCompletionRebase();
      onInpaintComplete?.(resultImageUrl, runSourceRef.current);
      // Issue #561: save the completed version to the history. Thumbnail
      // generation requires browser canvas, so run it here. Errors are
      // non-fatal — the version row is best-effort.
      if (typeof window !== "undefined" && resultImageUrl) {
        void (async () => {
          try {
            const thumbnailDataUrl = await generateThumbnailFromUrl(resultImageUrl, 200);
            await saveInpaintVersion({
              roomId,
              variantSlot,
              resultUrl: resultImageUrl,
              thumbnailDataUrl,
              seed: undefined,
              promptDirectives,
            });
          } catch (err) {
            console.error("[inpaint-editor] failed to save inpaint version:", err);
          }
        })();
      }
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
  // Issue #562: globalDirectives are merged with room directives for AI prompts.
  // Issue #1362b: the AI-guidance params were renamed (`promptStrength`
  // → `strength`, DashScope wire name) and the legacy fields
  // (`maskBlur`, `creativeMode`, `lockSeed`) were removed. The
  // submit body only carries `strength` + `seed` now.
  const beginInpaintRun = useCallback(
    async (run: {
      maskUrl: string;
      promptDirectives: string;
      negativePrompt?: string;
      sourceUrl?: string;
      globalDirectives?: string;
      /** Issue #1362b: DashScope `parameters.strength` (0..1). */
      strength?: number;
      /** Issue #1362b: DashScope `parameters.seed` (0..999999). */
      seed?: number;
    }) => {
      // Issue #562: merge global + room directives for AI (same merge the
      // server-side prompt builders use — lib/prompts.mergeDirectives).
      const mergedDirectives = mergeDirectives(
        run.globalDirectives ?? globalDirectives,
        run.promptDirectives
      );

      if (!mergedDirectives) {
        showError("No staging directives available.");
        return;
      }
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

      // Issue #1457 — the documented segment-mask preparation is applied
      // HERE, on the one seam every dispatched mask passes: this shared
      // submit path posts the brush masks, the thematic-union mask, the
      // per-object SAM region masks and the holistic masks to
      // `POST /api/inpaint`. `prepareMaskForDispatch` calls the pinned
      // `prepareSegmentMaskGrid` (erosion at the documented 4 px
      // default, hole fill on, no closing) — the erosion itself lives
      // in `src/lib/segment-mask-prepare.ts` / `src/lib/mask-erosion.ts`
      // and is not re-implemented here. A mask that cannot be prepared
      // is dispatched unchanged (a failed preparation never blocks a
      // run).
      const dispatchMaskUrl = await prepareMaskForDispatch(run.maskUrl);

      await start(async (signal) => {
        const startResponse = await fetch("/api/inpaint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageUrl: run.sourceUrl ?? imageUrl,
            maskUrl: dispatchMaskUrl,
            promptDirectives: mergedDirectives,
            negativePrompt: run.negativePrompt,
            aesthetic,
            roomId,
            variantSlot,
            sourceSlot: source.kind === "variant" ? source.slot : null,
            // Issue #1362b: `strength` + `seed` only. The route's
            // inpaintRequestSchema is `.strict()` (issue #1362b) so
            // any legacy field names would 400 the request.
            strength: run.strength,
            seed: run.seed,
          }),
          signal,
        });

        const startData = await startResponse.json();

        if (!startResponse.ok) {
          throw new Error(startData.message || startData.error || "Failed to start inpainting");
        }

        // Issue #1135: the submit path returns `degraded: true` when the
        // fal job was accepted but its durable InpaintRequest row could
        // not be written. Polling that requestId 404s, the poller reads
        // 404 as terminal, and the terminal path offers "Retry
        // inpainting" — billing a second fal job for a run whose result
        // is already unrecoverable. Fail here instead, non-retryably, so
        // the user is billed once and told plainly.
        if (startData.degraded === true) {
          throw new InpaintJobLostError();
        }

        return startData.requestId as string;
      });
    },
    [imageUrl, aesthetic, roomId, variantSlot, source, start, showError, globalDirectives]
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
            globalDirectives,
            // Issue #1362b: guidance renamed; `maskBlur` /
            // `creativeMode` / `lockSeed` are gone.
            strength: guidance.strength,
            seed: guidance.seed,
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
            plan.steps.length === 1 ? "region" : "regions"
          } staged.`
        );
      } finally {
        batchActiveRef.current = false;
      }
    },
    [beginInpaintRun, showSuccess, globalDirectives, guidance, setBatchSelections, setSelectedInstanceIndices]
  );

  // Issue #203: batch entry point from the panel. Builds the validated
  // plan (pure logic in multi-select-batch.ts), then either runs the
  // thematic single run (union mask + one prompt through the shared
  // launcher) or kicks off the sequential per-object runner.
  const handleBatchRun = useCallback(
    (input: {
      mode: BatchPromptMode;
      thematicPrompt: string;
      perObjectPrompts: string[];
      declutterMode: boolean;
      declutterIntensity: DeclutterIntensity;
    }) => {
      const built = buildBatchPlan({
        selections: batchSelections,
        mode: input.mode,
        thematicPrompt: input.thematicPrompt,
        perObjectPrompts: input.perObjectPrompts,
        unionMaskDataUrl,
        declutterMode: input.declutterMode,
        declutterIntensity: input.declutterIntensity,
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
          globalDirectives,
          // Issue #1362b: guidance renamed; `maskBlur` /
          // `creativeMode` / `lockSeed` are gone.
          strength: guidance.strength,
          seed: guidance.seed,
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
    [batchSelections, unionMaskDataUrl, beginInpaintRun, runPerObjectBatch, showError, globalDirectives, guidance, setBatchSelections, setSelectedInstanceIndices]
  );

  const handleBatchRetry = useCallback(() => {
    if (!activeBatch) return;
    void runPerObjectBatch(activeBatch.plan, activeBatch.progress);
  }, [activeBatch, runPerObjectBatch]);

  // Issue #846: extracted from inpaint-editor.tsx — encapsulates the
  // validation + beginInpaintRun call so the editor shrinks below 400 lines.
  const submitInpaint = useCallback(
    async (maskDataUrl: string) => {
      if (!promptDirectives.trim()) {
        showError("Add staging directives to brief the AI on your vision.");
        return;
      }
      if (!maskDataUrl) {
        showError("Please draw a mask on the image first.");
        return;
      }
      await beginInpaintRun({
        maskUrl: maskDataUrl,
        promptDirectives: promptDirectives.trim(),
      });
    },
    [promptDirectives, showError, beginInpaintRun]
  );

  // Issue #846: extracted from inpaint-editor.tsx — just forwards params
  // since beginInpaintRun already accepts the AI guidance fields.
  // Issue #1362b: `promptStrength` → `strength`; the legacy fields
  // (`maskBlur` / `creativeMode` / `lockSeed`) are gone. Default
  // `strength` is 0.6 — the documented whole-room default, mirroring
  // the legacy pre-Stage-B behavior. (The route's persisted default
  // is 50 UI = 0.5 at the wire; 0.6 here is the holistic spike
  // caller's default.)
  const submitHolisticRun = useCallback(
    (run: {
      maskDataUrl: string;
      promptDirectives: string;
      negativePrompt?: string;
      strength?: number;
      seed?: number;
    }) => {
      const { strength = 0.6, seed } = run;
      beginInpaintRun({
        maskUrl: run.maskDataUrl,
        promptDirectives: run.promptDirectives,
        negativePrompt: run.negativePrompt,
        strength,
        seed,
      });
    },
    [beginInpaintRun]
  );

  return {
    isProcessing,
    statusText,
    beginInpaintRun,
    handleBatchRun,
    handleBatchRetry,
    activeBatch,
    submitInpaint,
    submitHolisticRun,
  };
}
