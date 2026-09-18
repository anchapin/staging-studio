/**
 * Multi-select + per-object prompt batching for the SAM Select Object tool
 * (issue #203).
 *
 * Pro-editing epic part 2: consecutive Select Object clicks accumulate into
 * a pending selection set (capped, see {@link MAX_BATCH_OBJECTS}), and the
 * batch is applied either as
 *
 * - **thematic** — one prompt over the union mask of every selected object
 *   (a single inpaint run; the existing single-run flow), or
 * - **per-object** — an ordered prompt per object, each run pairing that
 *   object's own mask with its prompt. Runs execute SEQUENTIALLY (never in
 *   parallel — fal queue handling, polling, and persistence stay intact),
 *   each writing into the same target variant slot so results stack: run
 *   N+1's source image is run N's persisted result URL.
 *
 * Atomicity model (deliberately simple, no transactions): every step is a
 * complete, independently persisted inpaint run. If step 2 of 3 fails,
 * step 1's persisted result stays in the variant slot and the remaining
 * steps stay pending; the batch panel offers "Retry remaining", which
 * re-runs only unfinished steps, chaining again from the last completed
 * result. Earlier results are never rolled back.
 *
 * Pure logic only — canvas rasterization (decoding mask PNGs, serializing
 * the union) lives in the editor component; side effects: none.
 */

import { isMaskedPixel } from "./mask-coverage";

/**
 * Batch size cap. Each object is a separate billed FLUX.1 Fill generation,
 * and per-object results stack sequentially — small batches keep fal queue
 * time, daily quota spend (#201), and result predictability bounded.
 */
export const MAX_BATCH_OBJECTS = 5;

/**
 * One pending multi-select object: where it was selected and its own mask.
 * Since issue #229 the only source is the concept tool's toggled instances;
 * the set structure and reducer are unchanged from #203.
 */
export interface BatchSelection {
  /** Unique, stable id for the lifetime of the selection set. */
  id: string;
  /**
   * Selection point, used as the duplicate key (same rounded point = same
   * object). Concept-sourced entries carry the toggle point in mask-canvas
   * pixel space; the exact space only needs to be homogeneous within one
   * set, which holds now that every entry is concept-sourced.
   */
  point: { x: number; y: number };
  /**
   * The object's white-on-black mask as a `data:image` PNG, already scaled
   * to the photo's natural pixel dimensions (the editor normalizes on
   * selection, so every mask in the set shares one geometry).
   */
  maskDataUrl: string;
  /**
   * Detection concept the instance was toggled from (issue #229), shown in
   * the batch panel; omitting it falls back to the positional `Object N`
   * label.
   */
  conceptLabel?: string;
}

/** How prompts map onto the selected objects. */
export type BatchPromptMode = "thematic" | "per-object";

// ---------------------------------------------------------------------------
// Selection set reducer
// ---------------------------------------------------------------------------

export type SelectionSetAction =
  | { type: "add"; selection: BatchSelection }
  | { type: "removeLast" }
  | { type: "remove"; id: string }
  | { type: "clear" };

/** Result of a reduction: the next set plus why an `add` was refused. */
export interface SelectionSetReduction {
  selections: BatchSelection[];
  /** `cap` = at {@link MAX_BATCH_OBJECTS}; `duplicate` = same rounded point. */
  rejected: "cap" | "duplicate" | null;
}

/**
 * Reduces the pending multi-select selection set.
 *
 * Contract: `add` refuses (state unchanged, `rejected` set) when the set is
 * at {@link MAX_BATCH_OBJECTS} or when an existing selection rounds to the
 * same natural pixel point (clicking the same object twice). `removeLast`
 * on an empty set is a no-op. Never mutates the input array.
 * Side effects: none (pure).
 */
export function reduceSelectionSet(
  state: BatchSelection[],
  action: SelectionSetAction
): SelectionSetReduction {
  switch (action.type) {
    case "add": {
      if (state.length >= MAX_BATCH_OBJECTS) {
        return { selections: state, rejected: "cap" };
      }
      const roundedX = Math.round(action.selection.point.x);
      const roundedY = Math.round(action.selection.point.y);
      const duplicate = state.some(
        (selection) =>
          Math.round(selection.point.x) === roundedX &&
          Math.round(selection.point.y) === roundedY
      );
      if (duplicate) {
        return { selections: state, rejected: "duplicate" };
      }
      return { selections: [...state, action.selection], rejected: null };
    }
    case "removeLast":
      return { selections: state.slice(0, -1), rejected: null };
    case "remove":
      return { selections: state.filter((selection) => selection.id !== action.id), rejected: null };
    case "clear":
      return { selections: [], rejected: null };
  }
}

// ---------------------------------------------------------------------------
// Concept-toggle integration (issue #229): toggled concept instances are
// the only selection source feeding the batch panel.
// ---------------------------------------------------------------------------

/** Result of applying one instance toggle: both state pieces, in lockstep. */
export interface ConceptToggleReduction {
  selections: BatchSelection[];
  /** The canvas's tinted-instance indices, updated with the set. */
  selectedInstanceIndices: number[];
  /** Why an add was refused, inherited from {@link reduceSelectionSet}. */
  rejected: "cap" | "duplicate" | null;
}

/**
 * Applies one concept-instance toggle to BOTH pieces of selection state —
 * the batch selection set and the canvas's tinted-instance indices — in
 * lockstep, so the batch panel can never disagree with what the canvas
 * shows as selected (issue #229).
 *
 * Contract: toggling ON routes through {@link reduceSelectionSet}'s `add`,
 * so the cap ({@link MAX_BATCH_OBJECTS}) and duplicate-point rules are the
 * existing ones — no new limit logic. A refused add leaves BOTH pieces
 * unchanged (the instance does not light up on the canvas either).
 * Toggling OFF removes by id and rank; removing an absent id/index is a
 * no-op. Callers pass `turningOn` consistent with `selectedInstanceIndices`
 * (the toggle target's membership). Never mutates the inputs.
 * Side effects: none (pure).
 */
export function applyConceptToggle(
  selections: BatchSelection[],
  selectedInstanceIndices: number[],
  entry: BatchSelection,
  instanceIndex: number,
  turningOn: boolean
): ConceptToggleReduction {
  if (!turningOn) {
    return {
      selections: reduceSelectionSet(selections, { type: "remove", id: entry.id }).selections,
      selectedInstanceIndices: selectedInstanceIndices.filter((index) => index !== instanceIndex),
      rejected: null,
    };
  }
  const reduction = reduceSelectionSet(selections, { type: "add", selection: entry });
  if (reduction.rejected !== null) {
    return { selections: reduction.selections, selectedInstanceIndices, rejected: reduction.rejected };
  }
  return {
    selections: reduction.selections,
    selectedInstanceIndices: selectedInstanceIndices.includes(instanceIndex)
      ? selectedInstanceIndices
      : [...selectedInstanceIndices, instanceIndex],
    rejected: null,
  };
}

// ---------------------------------------------------------------------------
// Union mask composition (pure pixel math)
// ---------------------------------------------------------------------------

/** RGBA pixel buffer laid out like canvas `ImageData` (4 bytes per pixel). */
export interface BatchMaskBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/**
 * OR-composes per-object mask buffers into one union buffer.
 *
 * Purpose: the thematic batch mode is a single inpaint run over the union
 * of every selected object's mask. "Painted" reuses the mask editor's
 * exact semantics — {@link isMaskedPixel} (alpha ≥ 128 and luminance ≥
 * 128) — so the union agrees with what the canvas shows.
 *
 * Contract: returns `null` for an empty input, non-positive dimensions, or
 * mismatched buffer dimensions (masks are normalized to the photo's
 * natural dimensions upstream, so a mismatch is a programming error).
 * Output pixels are pure white where any input is painted, black
 * elsewhere, alpha 255. Inputs are never mutated.
 * Side effects: none (pure).
 */
export function unionMaskBuffers(buffers: BatchMaskBuffer[]): BatchMaskBuffer | null {
  if (buffers.length === 0) return null;
  const { width, height } = buffers[0];
  if (width <= 0 || height <= 0) return null;
  for (const buffer of buffers) {
    if (buffer.width !== width || buffer.height !== height) return null;
  }

  const data = new Uint8ClampedArray(width * height * 4);
  const pixels = width * height;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    for (const buffer of buffers) {
      if (
        isMaskedPixel(buffer.data[o], buffer.data[o + 1], buffer.data[o + 2], buffer.data[o + 3])
      ) {
        data[o] = 255;
        data[o + 1] = 255;
        data[o + 2] = 255;
        break;
      }
    }
    data[o + 3] = 255;
  }
  return { width, height, data };
}

// ---------------------------------------------------------------------------
// Batch plan builder
// ---------------------------------------------------------------------------

/** One per-object step: this object's mask paired with this object's prompt. */
export interface BatchPlanStep {
  selectionId: string;
  /** Human label, e.g. `Object 2` (1-based selection order). */
  label: string;
  maskDataUrl: string;
  promptDirectives: string;
}

export interface ThematicBatchPlan {
  kind: "thematic";
  /** Union mask of every selection (single run). */
  maskDataUrl: string;
  promptDirectives: string;
}

export interface PerObjectBatchPlan {
  kind: "per-object";
  /** Ordered steps; executed sequentially, results stacking into one slot. */
  steps: BatchPlanStep[];
}

export type BatchPlan = ThematicBatchPlan | PerObjectBatchPlan;

export interface BuildBatchPlanInput {
  selections: BatchSelection[];
  mode: BatchPromptMode;
  thematicPrompt: string;
  /** Ordered per-object prompts, parallel to `selections`. */
  perObjectPrompts: string[];
  /** Pre-composed union mask; required for (and only for) thematic runs. */
  unionMaskDataUrl: string | null;
}

export type BatchPlanResult =
  | { ok: true; plan: BatchPlan }
  | { ok: false; error: string };

/** 1-based display label for a selection/step index. */
export function batchStepLabel(index: number): string {
  return `Object ${index + 1}`;
}

/** Prompt bound mirrored from the inpaint route's `promptDirectives` schema. */
const MAX_PROMPT_LENGTH = 2000;

function promptError(prompt: string, label: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return `${label}: enter a prompt describing the change.`;
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    return `${label}: the prompt exceeds the ${MAX_PROMPT_LENGTH}-character limit.`;
  }
  return null;
}

/**
 * Validates the batch form and builds the runnable plan.
 *
 * Contract: requires at least one selection. Thematic mode requires a
 * non-empty composed union mask and one valid prompt (trimmed 1–2000
 * chars, mirroring the `/api/inpaint` route's bound). Per-object mode
 * requires exactly one prompt per selection, every prompt valid; steps
 * carry each selection's own (natural-dimension) mask so the sequential
 * runner can pair mask+prompt per run. Error strings are user-facing copy.
 * Side effects: none (pure).
 */
export function buildBatchPlan(input: BuildBatchPlanInput): BatchPlanResult {
  if (input.selections.length === 0) {
    return { ok: false, error: "Select at least one object before running a batch." };
  }

  if (input.mode === "thematic") {
    if (!input.unionMaskDataUrl) {
      return {
        ok: false,
        error: "The combined mask is still being prepared. Please try again.",
      };
    }
    const error = promptError(input.thematicPrompt, "Thematic prompt");
    if (error) return { ok: false, error };
    return {
      ok: true,
      plan: {
        kind: "thematic",
        maskDataUrl: input.unionMaskDataUrl,
        promptDirectives: input.thematicPrompt.trim(),
      },
    };
  }

  if (input.perObjectPrompts.length !== input.selections.length) {
    return { ok: false, error: "Every selected object needs its own prompt." };
  }

  const steps: BatchPlanStep[] = [];
  for (let i = 0; i < input.selections.length; i++) {
    const label = batchStepLabel(i);
    const error = promptError(input.perObjectPrompts[i], label);
    if (error) return { ok: false, error };
    steps.push({
      selectionId: input.selections[i].id,
      label,
      maskDataUrl: input.selections[i].maskDataUrl,
      promptDirectives: input.perObjectPrompts[i].trim(),
    });
  }
  return { ok: true, plan: { kind: "per-object", steps } };
}

// ---------------------------------------------------------------------------
// Per-object progress state machine
// ---------------------------------------------------------------------------

export type BatchStepStatus = "pending" | "running" | "completed" | "failed";

export interface BatchStepProgress {
  selectionId: string;
  label: string;
  status: BatchStepStatus;
  /** Failure detail for `failed` steps; null otherwise. */
  error: string | null;
  /**
   * Persisted result URL of a completed step. The sequential runner chains
   * it as the next step's source image so results stack into the same
   * variant slot — and a retry resumes chaining from the last completed
   * step instead of re-running it.
   */
  resultUrl?: string;
}

export interface BatchProgress {
  steps: BatchStepProgress[];
}

export type BatchStepEvent =
  | { kind: "start"; index: number }
  | { kind: "complete"; index: number; resultUrl?: string }
  | { kind: "fail"; index: number; message: string };

/** Fresh progress for a plan: every step pending. Side effects: none. */
export function initialBatchProgress(steps: BatchPlanStep[]): BatchProgress {
  return {
    steps: steps.map((step) => ({
      selectionId: step.selectionId,
      label: step.label,
      status: "pending" as const,
      error: null,
    })),
  };
}

/**
 * Applies one step event to the progress state.
 *
 * Contract: `start` moves any step to `running` and clears its error (this
 * is the retry path for a previously failed step); `complete` and `fail`
 * only apply to a `running` step — any other transition is a no-op
 * returning the original state. Never mutates the input.
 * Side effects: none (pure).
 */
export function advanceBatchProgress(
  progress: BatchProgress,
  event: BatchStepEvent
): BatchProgress {
  const step = progress.steps[event.index];
  if (!step) return progress;

  if (event.kind === "start") {
    const steps = progress.steps.map((entry, index) =>
      index === event.index ? { ...entry, status: "running" as const, error: null } : entry
    );
    return { steps };
  }

  if (step.status !== "running") return progress;

  const steps = progress.steps.map((entry, index) => {
    if (index !== event.index) return entry;
    if (event.kind === "complete") {
      return { ...entry, status: "completed" as const, resultUrl: event.resultUrl };
    }
    return { ...entry, status: "failed" as const, error: event.message };
  });
  return { steps };
}

/** Whether any step failed (completed steps are kept either way). */
export function hasFailedStep(progress: BatchProgress): boolean {
  return progress.steps.some((step) => step.status === "failed");
}

/**
 * Steps still needing a run: pending, running, or failed. Completed steps
 * are never re-run on retry — their persisted results stay.
 */
export function remainingStepCount(progress: BatchProgress): number {
  return progress.steps.filter(
    (step) => step.status !== "completed"
  ).length;
}

/**
 * Human progress text for a running batch, e.g. `Object 2 of 3`; null
 * when no step is currently running.
 */
export function batchProgressText(progress: BatchProgress): string | null {
  const index = progress.steps.findIndex((step) => step.status === "running");
  if (index === -1) return null;
  return `${batchStepLabel(index)} of ${progress.steps.length}`;
}
