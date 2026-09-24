"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useInpaintStatus } from "./use-inpaint-status";
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
import { generateThumbnailFromUrl } from "./version-history-panel";
import { saveInpaintVersion } from "@/app/actions/inpaint-versions";

/** Issue #558: AI guidance parameters shared by every run path. */
export interface InpaintRunGuidance {
  promptStrength: number;
  maskBlur: number;
  seed: number | undefined;
  creativeMode: boolean;
  lockSeed: boolean;
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

  // Issue #203: the status hook routes success/failure through these
  // callbacks, and `start()` itself never throws — so batch steps report
  // outcomes through refs. While a per-object batch is active, the generic
  // success toast is suppressed (the batch panel shows per-step progress)
  // and failures are captured for the panel's retry affordance instead of
  // the toast's own single-step retry.
  const { isProcessing, statusText, start, retryPoll } = useInpaintStatus({
    onCompleted: (resultImageUrl, persisted) => {
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
  const beginInpaintRun = useCallback(
    async (run: {
      maskUrl: string;
      promptDirectives: string;
      negativePrompt?: string;
      sourceUrl?: string;
      globalDirectives?: string;
      // Issue #558: AI guidance
      promptStrength?: number;
      maskBlur?: number;
      seed?: number;
      creativeMode?: boolean;
      lockSeed?: boolean;
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

      // Issue #558: resolve effective seed — use explicit seed only when lockSeed is true
      const effectiveSeed = run.lockSeed ? run.seed : undefined;

      await start(async (signal) => {
        const startResponse = await fetch("/api/inpaint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageUrl: run.sourceUrl ?? imageUrl,
            maskUrl: run.maskUrl,
            promptDirectives: mergedDirectives,
            negativePrompt: run.negativePrompt,
            aesthetic,
            roomId,
            variantSlot,
            sourceSlot: source.kind === "variant" ? source.slot : null,
            // Issue #558: AI guidance params
            promptStrength: run.promptStrength,
            maskBlur: run.maskBlur,
            seed: effectiveSeed,
            creativeMode: run.creativeMode,
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
            promptStrength: guidance.promptStrength,
            maskBlur: guidance.maskBlur,
            seed: guidance.seed,
            creativeMode: guidance.creativeMode,
            lockSeed: guidance.lockSeed,
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
          promptStrength: guidance.promptStrength,
          maskBlur: guidance.maskBlur,
          seed: guidance.seed,
          creativeMode: guidance.creativeMode,
          lockSeed: guidance.lockSeed,
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

  return {
    isProcessing,
    statusText,
    beginInpaintRun,
    handleBatchRun,
    handleBatchRetry,
    activeBatch,
  };
}
