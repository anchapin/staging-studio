import type { BatchPlanStep } from "./multi-select-batch";

/**
 * Human-readable step label used in progress text.
 * Extracted here because it is owned by the progress state machine and referenced
 * by `batchProgressText` in this module.
 */
export function batchStepLabel(index: number): string {
  return `Region ${index + 1}`;
}

// ---------------------------------------------------------------------------
// Progress state machine
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
