"use client";

import { useState } from "react";
import { Check, Circle, Loader2, X } from "lucide-react";
import {
  batchProgressText,
  batchStepLabel,
  hasFailedStep,
  remainingStepCount,
  type BatchPromptMode,
  type BatchProgress,
  type BatchSelection,
  type PerObjectBatchPlan,
} from "@/lib/multi-select-batch";
import { buildPrefill } from "@/lib/prompt-prefill";
import { resolveRegionLabel } from "@/lib/vision-labels";
import { paletteCssColor } from "./inpaint-mask-canvas";

/**
 * The per-object batch in flight or kept alive after a failure (for the
 * retry affordance). Progress is driven by the editor's sequential runner.
 */
export interface ActiveBatch {
  plan: PerObjectBatchPlan;
  progress: BatchProgress;
}

interface BatchStagingPanelProps {
  /** The pending selection set, in toggle order. */
  selections: BatchSelection[];
  /** Selection cap (mirrors MAX_BATCH_OBJECTS; shown in the copy). */
  maxObjects: number;
  /** True while segmenting or otherwise busy — block prompt edits + ops. */
  disabled: boolean;
  /** True while an inpaint run (batch step or otherwise) is in flight. */
  processing: boolean;
  /** Per-object batch progress, when one has been started. */
  activeBatch: ActiveBatch | null;
  /** Run the batch; payloads are pre-validated non-empty by this panel. */
  onRun: (input: {
    mode: BatchPromptMode;
    thematicPrompt: string;
    perObjectPrompts: string[];
  }) => void;
  /** Re-run only the unfinished steps of the failed batch. */
  onRetryRemaining: () => void;
  onRemoveLast: () => void;
  /**
   * Issue #252 D4: per-instance vision labels (parallel to the detection
   * response), or null while unlabeled. Feeds region labels and pre-fill;
   * the concept string is the fallback.
   */
  instanceLabels?: Array<string | null> | null;
}

/**
 * Multi-select batch panel (issue #203): prompt composition for the
 * accumulated selection set, mirroring the #191 preset's panel style.
 * Since issue #229 the entries come exclusively from toggled SAM 3.1
 * concept instances — the old per-click SAM source is removed. UX +
 * wiring only — plan building/validation lives in
 * `multi-select-batch.ts`, and the editor owns execution (thematic = one
 * run over the union mask; per-object = sequential runs, one per object,
 * stacking into the same variant slot).
 */
export default function BatchStagingPanel({
  selections,
  maxObjects,
  disabled,
  processing,
  activeBatch,
  onRun,
  onRetryRemaining,
  onRemoveLast,
  instanceLabels,
}: BatchStagingPanelProps) {
  const [mode, setMode] = useState<BatchPromptMode>("thematic");
  const [thematicPrompt, setThematicPrompt] = useState("");
  const [promptsBySelection, setPromptsBySelection] = useState<Record<string, string>>({});

  // Issue #230: per-object rows pre-fill with the selection's concept
  // label ("Replace the chair with ") — editable text, so a wrong
  // CLIP/human label is fixable in one keystroke. An explicitly stored
  // value always wins (`??` only fills untouched rows), so clearing the
  // seed and typing raw directives degrades to today's behavior with no
  // mode flag. Unlabeled entries ("Object N") get no seed. The thematic
  // (union) field stays empty on purpose — "Replace the furniture, rug
  // with…" is nonsense across a union mask; that path owns the holistic
  // vocabulary (its textarea keeps the plain "" initial state above).
  // Issue #252 D4: the label source of truth is the vision label when
  // available, the concept string otherwise. A merged region's label joins
  // its unique member labels ("sofa and coffee table"); a single-instance
  // region uses its own label. Feeds row headers AND pre-fill (AC-3.3/3.4).
  const regionLabel = (selection: BatchSelection): string => {
    const members = selection.memberInstanceIndices ?? [];
    const memberLabels = members.map((index) => instanceLabels?.[index] ?? null);
    return resolveRegionLabel(memberLabels, selection.conceptLabel ?? "");
  };

  /** Row header: region label with the positional `Region N` as fallback. */
  const entryLabel = (selection: BatchSelection, index: number) => {
    const label = regionLabel(selection);
    return label || batchStepLabel(index);
  };

  const orderedPrompts = selections.map((selection) =>
    promptsBySelection[selection.id] !== undefined
      ? promptsBySelection[selection.id]
      : buildPrefill(regionLabel(selection) || selection.conceptLabel)
  );
  const batchRunning = processing && activeBatch !== null;
  const thematicReady = thematicPrompt.trim().length > 0;
  const perObjectReady = orderedPrompts.every((prompt) => prompt.trim().length > 0);
  const canRun =
    !disabled &&
    !processing &&
    (mode === "thematic" ? thematicReady : perObjectReady) &&
    selections.length > 0;

  const setPrompt = (selectionId: string, value: string) => {
    setPromptsBySelection((previous) => ({ ...previous, [selectionId]: value }));
  };

  /** Concept name for concept-sourced entries; positional `Region N` otherwise. */

  const handleRun = () => {
    if (!canRun) return;
    onRun({ mode, thematicPrompt, perObjectPrompts: orderedPrompts });
  };

  const runningText = activeBatch ? batchProgressText(activeBatch.progress) : null;

  return (
    <section
      aria-label="Batch region staging"
      className="no-print flex flex-col gap-3 rounded-md border border-stone-300 bg-stone-50 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-800">
          Batch staging
          <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-xs font-normal text-stone-600">
            {selections.length} / {maxObjects} regions
          </span>
        </h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRemoveLast}
            disabled={disabled || selections.length === 0}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Undo last
          </button>
          {/* Issue #249: "Clear selection" moved beside the concept chips
              (inpaint-editor) — the one global control, instead of a
              duplicate button whose accessible name collided with it. */}
        </div>
      </div>

      <p className="text-xs text-stone-600">
        Selected regions come from toggling detected instances on the photo;
        nearby instances fuse into one region. Batches are capped at {maxObjects}{" "}
        regions — each one is a separate billed generation, and per-region
        results are applied one at a time so they stack into the same
        variant. Changing the selection rebuilds the mask.
      </p>

      <ol className="flex flex-wrap gap-1.5 text-xs text-stone-700">
        {selections.map((selection, index) => (
          <li
            key={selection.id}
            className="rounded-full border border-stone-300 bg-white px-2 py-0.5"
          >
            {entryLabel(selection, index)}
          </li>
        ))}
      </ol>

      <fieldset disabled={disabled || processing} className="min-w-0">
        <legend className="px-1 text-sm font-medium text-stone-700">Prompts</legend>
        <div className="mt-1 flex flex-col gap-1">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-stone-700">
            <input
              type="radio"
              name="batch-prompt-mode"
              value="thematic"
              checked={mode === "thematic"}
              onChange={() => setMode("thematic")}
              className="h-4 w-4 accent-stone-800"
            />
            One theme for all regions
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-stone-700">
            <input
              type="radio"
              name="batch-prompt-mode"
              value="per-object"
              checked={mode === "per-object"}
              onChange={() => setMode("per-object")}
              className="h-4 w-4 accent-stone-800"
            />
            A separate prompt per region
          </label>
        </div>

        <div className="mt-3">
          {mode === "thematic" ? (
            <>
              <label
                htmlFor="batch-thematic-prompt"
                className="block text-sm font-medium text-stone-700"
              >
                Theme (applied to all selected regions at once)
              </label>
              <textarea
                id="batch-thematic-prompt"
                value={thematicPrompt}
                onChange={(event) => setThematicPrompt(event.target.value)}
                rows={2}
                placeholder="e.g. replace the seating with warm mid-century pieces"
                className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-500"
              />
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-stone-700" id="batch-per-object-label">
                One prompt per region (applied in order; results stack)
              </p>
              <ol className="mt-1 flex flex-col gap-2">
                {selections.map((selection, index) => (
                  <li key={selection.id} className="flex flex-col">
                    <label
                      htmlFor={`batch-prompt-${selection.id}`}
                      className="flex items-center gap-1.5 text-xs font-medium text-stone-600"
                    >
                      {/* Issue #252 D4 (AC-3.1): numbered chip matching the
                          canvas badge, colored with the region's canvas tint
                          (region i → palette[i]) — per-object mode only. */}
                      <span
                        aria-hidden="true"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: paletteCssColor(index) }}
                      >
                        {index + 1}
                      </span>
                      {entryLabel(selection, index)} prompt
                    </label>
                    <input
                      id={`batch-prompt-${selection.id}`}
                      type="text"
                      value={orderedPrompts[index]}
                      onChange={(event) => setPrompt(selection.id, event.target.value)}
                      placeholder={
                        entryLabel(selection, index)
                          ? `e.g. replace the ${entryLabel(selection, index)} with ...`
                          : `e.g. replace ${batchStepLabel(index).toLowerCase()} with ...`
                      }
                      className="mt-0.5 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-500"
                    />
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </fieldset>

      {activeBatch && (
        <div className="rounded-md border border-stone-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-sm font-medium text-stone-800">Batch progress</h5>
            {runningText && (
              <span role="status" className="text-xs text-stone-600">
                Applying {runningText}
              </span>
            )}
          </div>
          <ol className="mt-2 flex flex-col gap-1.5">
            {activeBatch.progress.steps.map((step, index) => (
              <li key={step.selectionId} className="flex items-start gap-2 text-sm">
                <StepStatusIcon status={step.status} />
                <span className="min-w-0">
                  <span className="font-medium text-stone-800">{step.label}</span>
                  <span className="ml-2 text-xs text-stone-500">
                    {step.status === "pending" && "Waiting"}
                    {step.status === "running" && "Applying..."}
                    {step.status === "completed" && "Done"}
                    {step.status === "failed" && "Failed"}
                  </span>
                  {step.status === "failed" && step.error && (
                    <span className="block text-xs text-red-700">{step.error}</span>
                  )}
                </span>
                <span className="sr-only">
                  {batchStepLabel(index)} of {activeBatch.progress.steps.length}
                </span>
              </li>
            ))}
          </ol>
          {hasFailedStep(activeBatch.progress) && !batchRunning && (
            <div className="mt-3 flex flex-col gap-1.5">
              <button
                type="button"
                onClick={onRetryRemaining}
                disabled={processing}
                className="w-fit rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500"
              >
                Retry remaining ({remainingStepCount(activeBatch.progress)})
              </button>
              <p className="text-xs text-stone-600">
                Completed objects keep their staged results — only the
                unfinished objects run again, picking up from the last
                completed result.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRun}
          disabled={!canRun}
          aria-busy={processing}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
            transition-colors
            ${canRun
              ? "bg-stone-800 text-white hover:bg-stone-700"
              : "bg-stone-300 text-stone-500 cursor-not-allowed"
            }
          `}
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Staging...
            </>
          ) : (
            "Run batch"
          )}
        </button>
        {!processing && mode === "thematic" && !thematicReady && (
          <span className="text-xs text-stone-500">Enter a theme to enable the batch.</span>
        )}
        {!processing && mode === "per-object" && !perObjectReady && (
          <span className="text-xs text-stone-500">
            Every object needs a prompt to enable the batch.
          </span>
        )}
      </div>
    </section>
  );
}

function StepStatusIcon({ status }: { status: BatchProgress["steps"][number]["status"] }) {
  if (status === "completed") {
    return <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />;
  }
  if (status === "running") {
    return (
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-stone-600" aria-hidden="true" />
    );
  }
  if (status === "failed") {
    return <X className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />;
  }
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />;
}
