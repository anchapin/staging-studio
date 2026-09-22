"use client";

import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Circle, Loader2, Plus, Sparkles, X } from "lucide-react";
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
import { getAestheticChips } from "@/lib/aesthetic-chips";
import {
  DECLUTTER_INTENSITY_LABELS,
  type DeclutterIntensity,
} from "@/lib/holistic-prompt";

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
  /** Selection cap (mirrors MAX_BATCH_REGIONS; shown in the copy). */
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
    declutterMode: boolean;
    declutterIntensity: DeclutterIntensity;
  }) => void;
  /** Re-run only the unfinished steps of the failed batch. */
  onRetryRemaining: () => void;
  onRemoveLast: () => void;
  /** Issue #448: remove a specific selection by id. */
  onRemoveSelection: (id: string) => void;
  /**
   * Issue #252 D4: per-instance vision labels (parallel to the detection
   * response), or null while unlabeled. Feeds region labels and pre-fill;
   * the concept string is the fallback.
   */
  instanceLabels?: Array<string | null> | null;
  /**
   * The room's project `stagingAesthetic` (may be empty). Used to derive
   * contextual starter chips for the thematic prompt textarea.
   */
  aesthetic?: string;
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
  onRemoveSelection,
  instanceLabels,
  aesthetic,
}: BatchStagingPanelProps) {
  const [mode, setMode] = useState<BatchPromptMode>("thematic");
  const [thematicPrompt, setThematicPrompt] = useState("");
  const [promptsBySelection, setPromptsBySelection] = useState<Record<string, string>>({});
  const [declutterMode, setDeclutterMode] = useState(false);
  const [declutterIntensity, setDeclutterIntensity] = useState<DeclutterIntensity>(3);
  const thematicTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize the thematic textarea based on content
  useEffect(() => {
    const textarea = thematicTextareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 56), 140);
      textarea.style.height = `${newHeight}px`;
    }
  }, [thematicPrompt]);

  // Issue #442: append a starter chip phrase to the thematic prompt
  const appendChip = (chip: string) => {
    const textarea = thematicTextareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const textBefore = thematicPrompt.slice(0, cursorPos);
    const textAfter = thematicPrompt.slice(cursorPos);
    const separator = textBefore.length > 0 && !textBefore.endsWith(" ") ? " " : "";
    const newValue = `${textBefore}${separator}${chip}${textAfter}`;
    setThematicPrompt(newValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd =
        (textBefore.length + separator.length + chip.length);
    });
  };

  const aestheticChips = getAestheticChips(aesthetic ?? "");

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
    onRun({ mode, thematicPrompt, perObjectPrompts: orderedPrompts, declutterMode, declutterIntensity });
  };

  const runningText = activeBatch ? batchProgressText(activeBatch.progress) : null;

  // Issue #440: show incremental region progress on the button
  // Issue #455: thematic mode has no activeBatch (null), so derive progress from selections.length
  const runningStepIndex = activeBatch
    ? activeBatch.progress.steps.findIndex((s) => s.status === "running")
    : -1;
  const totalSteps = activeBatch ? activeBatch.progress.steps.length : 0;
  const buttonProgressText =
    runningStepIndex >= 0
      ? `Staging region ${runningStepIndex + 1} of ${totalSteps}...`
      : mode === "thematic" && processing
      ? `Staging ${selections.length} regions...`
      : null;

  return (
    <section
      aria-label="Batch region staging"
      className="no-print flex h-full flex-col gap-3 rounded-md border border-input bg-card p-4"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h4 className="text-sm font-semibold text-foreground">
            Batch staging
            <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              {selections.length} / {maxObjects} regions
            </span>
            {/* Issue #559: Global Declutter Mode toggle */}
            <button
              type="button"
              onClick={() => setDeclutterMode((prev) => !prev)}
              disabled={disabled || processing}
              aria-pressed={declutterMode}
              aria-label={`Declutter mode: ${declutterMode ? "on" : "off"}. Toggle to add decluttering directives to the AI prompt.`}
              className={`ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                declutterMode
                  ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                  : "border-input bg-background text-muted-foreground hover:border-orange-400 hover:text-orange-600"
              }`}
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Declutter
            </button>
          </h4>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRemoveLast}
              disabled={disabled || selections.length === 0}
              aria-label="Remove last selected region from batch"
            >
              Remove last
            </Button>
            {/* Issue #249: "Clear selection" moved beside the concept chips
                (inpaint-editor) — the one global control, instead of a
                duplicate button whose accessible name collided with it. */}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Selected regions come from toggling detected instances on the photo;
          nearby instances fuse into one region. Batches are capped at {maxObjects}{" "}
          regions — each one is a separate billed generation, and per-region
          results are applied one at a time so they stack into the same
          variant. Changing the selection rebuilds the mask.
        </p>

        <ol className="flex flex-wrap gap-1.5 text-xs text-foreground">
          {selections.map((selection, index) => (
            <li
              key={selection.id}
              className="inline-flex items-center gap-1 rounded-full border border-input bg-background px-2 py-0.5"
            >
              {entryLabel(selection, index)}
              <button
                type="button"
                onClick={() => onRemoveSelection(selection.id)}
                disabled={disabled || processing}
                aria-label={`Remove ${entryLabel(selection, index)} from batch`}
                className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none"
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>

        <fieldset disabled={disabled || processing} className="min-w-0">
          <legend className="px-1 text-sm font-medium text-foreground">Prompts</legend>
          <div className="mt-1 flex flex-col gap-1">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground" title="Apply one style to all selected objects together">
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
            <span className="ml-6 text-xs text-muted-foreground">
              Apply one style to all selected objects together
            </span>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground" title="Customize the style for each object individually">
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
            <span className="ml-6 text-xs text-muted-foreground">
              Customize the style for each object individually
            </span>
          </div>

          {/* Issue #559: Declutter intensity slider — only visible when declutter mode is on */}
          {declutterMode && (
            <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-950">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="declutter-intensity"
                  className="flex items-center gap-1.5 text-sm font-medium text-orange-800 dark:text-orange-200"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Declutter intensity
                </label>
                <span className="text-sm font-semibold text-orange-700 dark:text-orange-300">
                  {DECLUTTER_INTENSITY_LABELS[declutterIntensity]}
                </span>
              </div>
              <input
                id="declutter-intensity"
                type="range"
                min={1}
                max={5}
                step={1}
                value={declutterIntensity}
                onChange={(event) => setDeclutterIntensity(Number(event.target.value) as DeclutterIntensity)}
                aria-label="Declutter intensity"
                className="mt-2 w-full accent-orange-500"
              />
              <div className="mt-1 flex justify-between text-xs text-orange-600 dark:text-orange-400">
                <span>Light</span>
                <span>Full purge</span>
              </div>
            </div>
          )}

          <div className="mt-3">
            {mode === "thematic" ? (
              <>
                <label
                  htmlFor="batch-thematic-prompt"
                  className="block text-sm font-medium text-foreground"
                >
                  Theme (applied to all selected regions at once)
                </label>
                <textarea
                  ref={thematicTextareaRef}
                  id="batch-thematic-prompt"
                  value={thematicPrompt}
                  onChange={(event) => setThematicPrompt(event.target.value)}
                  rows={2}
                  placeholder="e.g. replace the seating with warm mid-century pieces"
                  className="mt-1 w-full min-h-[56px] max-h-[140px] resize-none rounded-md border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Style suggestions">
                  {aestheticChips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => appendChip(chip)}
                      className="inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:border-stone-400 hover:bg-secondary"
                    >
                      <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                      {chip}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground" id="batch-per-object-label">
                  One prompt per region (applied in order; results stack)
                </p>
                <ol className="mt-1 flex flex-col gap-2">
                  {selections.map((selection, index) => (
                    <li key={selection.id} className="flex flex-col">
                      <label
                        htmlFor={`batch-prompt-${selection.id}`}
                        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
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
                        className="mt-0.5 w-full rounded-md border border-input px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </fieldset>

        {activeBatch && (
          <div className="rounded-md border border-input bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-sm font-medium text-foreground">Batch progress</h5>
              {runningText && (
                <span role="status" className="text-xs text-muted-foreground">
                  Applying {runningText}
                </span>
              )}
            </div>
            <ol className="mt-2 flex flex-col gap-1.5">
              {activeBatch.progress.steps.map((step, index) => (
                <li key={step.selectionId} className="flex items-start gap-2 text-sm">
                  <StepStatusIcon status={step.status} />
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{step.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
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
                <Button
                  onClick={onRetryRemaining}
                  disabled={processing}
                  className="w-fit"
                >
                  Retry remaining ({remainingStepCount(activeBatch.progress)})
                </Button>
                <p className="text-xs text-muted-foreground">
                  Completed objects keep their staged results — only the
                  unfinished objects run again, picking up from the last
                  completed result.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Button
          onClick={handleRun}
          disabled={!canRun}
          aria-busy={processing}
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              {buttonProgressText ?? "Staging..."}
            </>
          ) : (
            "Run batch"
          )}
        </Button>
        {!processing && mode === "thematic" && !thematicReady && (
          <span className="text-xs text-muted-foreground">Enter a theme to enable the batch.</span>
        )}
        {!processing && mode === "per-object" && !perObjectReady && (
          <span className="text-xs text-muted-foreground">
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
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
    );
  }
  if (status === "failed") {
    return <X className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />;
  }
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}
