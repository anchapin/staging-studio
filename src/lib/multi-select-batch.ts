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
import { dilateMaskGrid } from "./mask-dilation";
import { MERGE_PROXIMITY_PX } from "./mask-postprocess";

/**
 * Batch size cap. Each region is a separate billed FLUX.1 Fill generation,
 * and per-region results stack sequentially — small batches keep fal queue
 * time, daily quota spend (#201), and result predictability bounded.
 * Since issue #252 the unit is a merged REGION (one or more proximate
 * object masks), not a single object.
 */
export const MAX_BATCH_OBJECTS = 5;

/**
 * One pending multi-select region: where it was seeded and its own mask.
 * Since issue #229 the only source is the concept tool's toggled instances;
 * since issue #252 the entry represents a merged region — one or more
 * proximate instance masks OR-unioned (composition happens browser-side).
 */
export interface BatchSelection {
  /** Unique, stable id for the lifetime of the selection set. */
  id: string;
  /**
   * Selection point, used as the duplicate key (same rounded point = same
   * object). Concept-sourced entries carry the toggle point in mask-canvas
   * pixel space; the exact space only needs to be homogeneous within one
   * set, which holds now that every entry is concept-sourced. For a merged
   * region this is the seed point of its first (best-ranked) member.
   */
  point: { x: number; y: number };
  /**
   * The region's white-on-black mask as a `data:image` PNG, already scaled
   * to the photo's natural pixel dimensions (the editor normalizes on
   * selection, so every mask in the set shares one geometry). For a merged
   * region the editor recomposes this from the members' masks
   * (union → closing → hole fill, issue #252 D2/D3).
   */
  maskDataUrl: string;
  /**
   * Detection concept the instance was toggled from (issue #229), shown in
   * the batch panel; omitting it falls back to the positional `Region N`
   * label.
   */
  conceptLabel?: string;
  /**
   * Detection-response indices of the instances fused into this region
   * (issue #252 D2), in ascending response order. A single-instance region
   * carries exactly its own index. Optional for backwards compatibility
   * with callers that predate the region model — such entries cannot take
   * part in proximity merging (no member grids are known).
   */
  memberInstanceIndices?: number[];
}

/** How prompts map onto the selected regions. */
export type BatchPromptMode = "thematic" | "per-object";

/**
 * A detected instance's binary mask at mask-canvas resolution (the space
 * {@link MERGE_PROXIMITY_PX} lives in). Grids of one detection response
 * share dimensions.
 */
export interface InstanceMaskGrid {
  grid: Uint8Array;
  width: number;
  height: number;
}

/**
 * True when the two masks lie within `radius` grid pixels of each other:
 * dilating `a` by `radius` (circular kernel, same semantics as
 * `dilateMaskGrid`) reaches some cell of `b`. This is exact mask-to-mask
 * proximity — the edge predicate for both the toggle path's merge decision
 * and select-all's proximity graph (issue #252 D2). Radius 0 still matches
 * overlapping/touching masks. Malformed geometry returns false.
 * Side effects: none (pure).
 */
export function masksWithinProximity(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
  radius: number
): boolean {
  if (width <= 0 || height <= 0) return false;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;

  const total = width * height;
  if (a.length < total || b.length < total) return false;

  const r = Number.isFinite(radius) ? Math.max(0, Math.floor(radius)) : 0;
  const dilated = dilateMaskGrid(a, width, height, r);
  if (!dilated) return false;

  for (let i = 0; i < total; i++) {
    if (dilated.mask[i] === 1 && b[i] === 1) return true;
  }
  return false;
}

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
 * Grids for every detected instance of the active concept, by
 * detection-response index. Supplying this context turns ON the proximity
 * merge (issue #252 D2): a toggled instance whose mask comes within
 * {@link MERGE_PROXIMITY_PX} of an existing region's member mask fuses
 * into that region instead of adding a row.
 */
export interface ConceptToggleContext {
  instanceGrids: ReadonlyMap<number, InstanceMaskGrid>;
}

/**
 * Applies one concept-instance toggle to BOTH pieces of selection state —
 * the batch selection set and the canvas's tinted-instance indices — in
 * lockstep, so the batch panel can never disagree with what the canvas
 * shows as selected (issue #229).
 *
 * Contract: toggling OFF removes by id and rank; removing an absent
 * id/index is a no-op. Toggling ON first checks the duplicate-point rule
 * (unchanged precedence), then — when `context` supplies grids — the
 * proximity merge: the instance fuses into the FIRST region one of whose
 * member masks lies within {@link MERGE_PROXIMITY_PX} of the instance's
 * mask (issue #252 D2). Merging updates only that region's membership —
 * one row, one prompt, one billed run — and never consumes cap headroom.
 * Without a proximity match (or without grids) the toggle routes through
 * {@link reduceSelectionSet}'s `add`, so the cap
 * ({@link MAX_BATCH_OBJECTS}) and duplicate rules stay the existing ones.
 * A refused add leaves BOTH pieces unchanged. Callers pass `turningOn`
 * consistent with `selectedInstanceIndices`. Never mutates the inputs.
 * Side effects: none (pure).
 */
export function applyConceptToggle(
  selections: BatchSelection[],
  selectedInstanceIndices: number[],
  entry: BatchSelection,
  instanceIndex: number,
  turningOn: boolean,
  context?: ConceptToggleContext
): ConceptToggleReduction {
  if (!turningOn) {
    return {
      selections: reduceSelectionSet(selections, { type: "remove", id: entry.id }).selections,
      selectedInstanceIndices: selectedInstanceIndices.filter((index) => index !== instanceIndex),
      rejected: null,
    };
  }

  const entryGrid = context?.instanceGrids.get(instanceIndex);
  if (context && entryGrid) {
    // Duplicate-point precedence: the same rounded point is the same object
    // regardless of mask proximity (unchanged rule).
    const duplicate = reduceSelectionSet(selections, { type: "add", selection: entry });
    if (duplicate.rejected === "duplicate") {
      return { selections, selectedInstanceIndices, rejected: "duplicate" };
    }

    for (const selection of selections) {
      const members = selection.memberInstanceIndices;
      if (!members) continue;
      const near = members.some((member) => {
        const memberGrid = context.instanceGrids.get(member);
        return memberGrid
          ? masksWithinProximity(
              entryGrid.grid,
              memberGrid.grid,
              memberGrid.width,
              memberGrid.height,
              MERGE_PROXIMITY_PX
            )
          : false;
      });
      if (near) {
        return {
          selections: selections.map((candidate) =>
            candidate.id === selection.id
              ? {
                  ...candidate,
                  memberInstanceIndices: [...members, instanceIndex].sort((a, b) => a - b),
                }
              : candidate
          ),
          selectedInstanceIndices: selectedInstanceIndices.includes(instanceIndex)
            ? selectedInstanceIndices
            : [...selectedInstanceIndices, instanceIndex],
          rejected: null,
        };
      }
    }
  }

  const reduction = reduceSelectionSet(selections, {
    type: "add",
    selection: { ...entry, memberInstanceIndices: entry.memberInstanceIndices ?? [instanceIndex] },
  });
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

/**
 * One candidate for {@link applyConceptSelectAll}: a detected instance plus
 * the entry it would add, its detection score (for component ranking), and
 * its mask-canvas grid (for proximity edges).
 */
export interface ConceptSelectAllCandidate {
  /** Position in the score-ranked detection response. */
  instanceIndex: number;
  /** The batch entry built from that instance's seed point. */
  entry: BatchSelection;
  /** Provider confidence, or null when the response omitted it (counts 0). */
  score: number | null;
  /** The instance's mask at mask-canvas resolution. */
  grid: InstanceMaskGrid;
}

/** Result of a bulk select-all: both state pieces plus what this call added. */
export interface ConceptSelectAllReduction {
  selections: BatchSelection[];
  /** The canvas's tinted-instance indices, updated with the set. */
  selectedInstanceIndices: number[];
  /** Indices of instances THIS call selected — the caller emits one `selection_logged` per entry. */
  addedInstanceIndices: number[];
  /** True when detection produced more regions than the cap allowed. */
  truncated: boolean;
}

/**
 * Bulk toggle-on for the editor's "Select all detected" control
 * (issue #249, reworked by #252).
 *
 * Algorithm: candidates (already-selected instances are skipped, as are
 * duplicate rounded seed points — that rule is unchanged) are clustered by
 * a proximity graph — an edge joins two instances whose masks lie within
 * {@link MERGE_PROXIMITY_PX} — and each connected component becomes ONE
 * region: one row, one badge, one prompt, one billed run. Components rank
 * by the SUM of their member detection scores (ties keep rank order);
 * ranking walks components, first merging any that sit within proximity of
 * an existing region (merging never consumes headroom), then filling the
 * remaining headroom ({@link MAX_BATCH_OBJECTS} rows). When components
 * outrun the headroom the rest are left out and `truncated` reports it —
 * unlike the pre-#252 top-5 rule, ≤ 5 components always selects EVERY
 * instance, so fragments of one visual group no longer burn slots.
 *
 * Both state pieces move in lockstep with {@link applyConceptToggle}'s
 * guarantee: the batch panel and the canvas can never disagree. Never
 * mutates the inputs. Side effects: none (pure).
 */
export function applyConceptSelectAll(
  selections: BatchSelection[],
  selectedInstanceIndices: number[],
  candidates: readonly ConceptSelectAllCandidate[]
): ConceptSelectAllReduction {
  const grids = new Map<number, InstanceMaskGrid>();
  for (const candidate of candidates) grids.set(candidate.instanceIndex, candidate.grid);

  // Walk candidates in rank order: skip already-selected instances and
  // duplicate rounded seed points (vs the existing set AND this walk).
  const kept: ConceptSelectAllCandidate[] = [];
  const keptPoints: Array<{ x: number; y: number }> = [];
  for (const candidate of candidates) {
    if (selectedInstanceIndices.includes(candidate.instanceIndex)) continue;
    const roundedX = Math.round(candidate.entry.point.x);
    const roundedY = Math.round(candidate.entry.point.y);
    const duplicate =
      selections.some(
        (selection) =>
          Math.round(selection.point.x) === roundedX &&
          Math.round(selection.point.y) === roundedY
      ) ||
      keptPoints.some((point) => Math.round(point.x) === roundedX && Math.round(point.y) === roundedY);
    if (duplicate) continue;
    kept.push(candidate);
    keptPoints.push(candidate.entry.point);
  }

  // Proximity graph over kept candidates + connected components (BFS).
  const componentOf = new Map<number, number>(); // instanceIndex → component id
  const components: Array<{ members: ConceptSelectAllCandidate[]; scoreSum: number }> = [];
  for (let i = 0; i < kept.length; i++) {
    const candidate = kept[i];
    if (candidate === undefined) continue;
    if (componentOf.has(candidate.instanceIndex)) continue;
    const componentId = components.length;
    const members: ConceptSelectAllCandidate[] = [candidate];
    let scoreSum = candidate.score ?? 0;
    componentOf.set(candidate.instanceIndex, componentId);
    const queue: ConceptSelectAllCandidate[] = [candidate];
    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined) break;
      for (const other of kept) {
        if (componentOf.has(other.instanceIndex)) continue;
        const near = masksWithinProximity(
          current.grid.grid,
          other.grid.grid,
          current.grid.width,
          current.grid.height,
          MERGE_PROXIMITY_PX
        );
        if (!near) continue;
        componentOf.set(other.instanceIndex, componentId);
        members.push(other);
        scoreSum += other.score ?? 0;
        queue.push(other);
      }
    }
    components.push({ members, scoreSum });
  }

  // Rank: score sum descending, ties keep first-seen (rank) order.
  const ranked = components
    .map((component, index) => ({ component, index }))
    .sort((a, b) => b.component.scoreSum - a.component.scoreSum || a.index - b.index);

  let nextSelections = selections;
  let nextIndices = selectedInstanceIndices;
  const addedInstanceIndices: number[] = [];
  let truncated = false;

  const addIndices = (memberIndices: number[]): void => {
    for (const index of memberIndices) {
      if (!nextIndices.includes(index)) nextIndices = [...nextIndices, index];
      addedInstanceIndices.push(index);
    }
  };

  for (const { component } of ranked) {
    const memberIndices = component.members
      .map((member) => member.instanceIndex)
      .sort((a, b) => a - b);

    // Merge into an existing region when any member mask lies within
    // proximity of the region's own member masks (issue #252 D2 parity
    // with the toggle path) — merging never consumes headroom.
    const mergeTarget = nextSelections.findIndex((selection) => {
      const members = selection.memberInstanceIndices;
      if (!members || members.length === 0) return false;
      return members.some((member) => {
        const memberGrid = grids.get(member);
        if (!memberGrid) return false;
        return component.members.some((candidate) =>
          masksWithinProximity(
            candidate.grid.grid,
            memberGrid.grid,
            memberGrid.width,
            memberGrid.height,
            MERGE_PROXIMITY_PX
          )
        );
      });
    });
    if (mergeTarget !== -1) {
      nextSelections = nextSelections.map((selection, index) =>
        index === mergeTarget
          ? {
              ...selection,
              memberInstanceIndices: [
                ...(selection.memberInstanceIndices ?? []),
                ...memberIndices,
              ],
            }
          : selection
      );
      addIndices(memberIndices);
      continue;
    }

    if (nextSelections.length >= MAX_BATCH_OBJECTS) {
      truncated = true;
      break;
    }

    const first = component.members[0];
    if (!first) continue;
    nextSelections = [
      ...nextSelections,
      {
        ...first.entry,
        memberInstanceIndices: memberIndices,
      },
    ];
    addIndices(memberIndices);
  }

  return { selections: nextSelections, selectedInstanceIndices: nextIndices, addedInstanceIndices, truncated };
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

/** One per-region step: this region's mask paired with this region's prompt. */
export interface BatchPlanStep {
  selectionId: string;
  /** Human label, e.g. `Region 2` (1-based region order). */
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

/** 1-based display label for a region/step index (issue #252: "regions" copy). */
export function batchStepLabel(index: number): string {
  return `Region ${index + 1}`;
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
    return { ok: false, error: "Select at least one region before running a batch." };
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
    return { ok: false, error: "Every selected region needs its own prompt." };
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
 * Human progress text for a running batch, e.g. `Region 2 of 3`; null
 * when no step is currently running.
 */
export function batchProgressText(progress: BatchProgress): string | null {
  const index = progress.steps.findIndex((step) => step.status === "running");
  if (index === -1) return null;
  return `${batchStepLabel(index)} of ${progress.steps.length}`;
}
