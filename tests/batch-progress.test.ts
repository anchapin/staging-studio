import { describe, expect, it } from "vitest";
import type { BatchPlanStep } from "@/lib/multi-select-batch";
import {
  advanceBatchProgress,
  batchProgressText,
  batchStepLabel,
  hasFailedStep,
  initialBatchProgress,
  remainingStepCount,
  type BatchStepProgress,
} from "@/lib/batch-progress";

const MASK_A = "data:image/png;base64,AAAA";
const MASK_B = "data:image/png;base64,BBBBBBBB";
const MASK_C = "data:image/png;base64,CCCC";

describe("batchStepLabel", () => {
  it("returns 1-based region label", () => {
    expect(batchStepLabel(0)).toBe("Region 1");
    expect(batchStepLabel(1)).toBe("Region 2");
    expect(batchStepLabel(4)).toBe("Region 5");
  });
});

describe("per-object progress state machine", () => {
  const steps: BatchPlanStep[] = [
    { selectionId: "a", label: "Region 1", maskDataUrl: MASK_A, promptDirectives: "p1" },
    { selectionId: "b", label: "Region 2", maskDataUrl: MASK_B, promptDirectives: "p2" },
    { selectionId: "c", label: "Region 3", maskDataUrl: MASK_C, promptDirectives: "p3" },
  ];

  it("starts with every step pending", () => {
    const progress = initialBatchProgress(steps);
    expect(progress.steps.map((step) => step.status)).toEqual(["pending", "pending", "pending"]);
    expect(progress.steps.map((step) => step.label)).toEqual(["Region 1", "Region 2", "Region 3"]);
  });

  it("moves a running step to completed and records its result URL", () => {
    let progress = initialBatchProgress(steps);
    progress = advanceBatchProgress(progress, { kind: "start", index: 0 });
    progress = advanceBatchProgress(progress, {
      kind: "complete",
      index: 0,
      resultUrl: "https://example.supabase.co/r1.png",
    });
    expect(progress.steps[0].status).toBe("completed");
    expect(progress.steps[0].resultUrl).toBe("https://example.supabase.co/r1.png");
  });

  it("ignores complete/fail for a step that never started", () => {
    const progress = initialBatchProgress(steps);
    expect(advanceBatchProgress(progress, { kind: "complete", index: 1 })).toBe(progress);
    expect(
      advanceBatchProgress(progress, { kind: "fail", index: 1, message: "boom" })
    ).toBe(progress);
  });

  it("ignores events for out-of-range indexes", () => {
    const progress = initialBatchProgress(steps);
    expect(advanceBatchProgress(progress, { kind: "start", index: 7 })).toBe(progress);
  });

  it("records the failure message on the failed step", () => {
    let progress = initialBatchProgress(steps);
    progress = advanceBatchProgress(progress, { kind: "start", index: 1 });
    progress = advanceBatchProgress(progress, { kind: "fail", index: 1, message: "fal queue died" });
    expect(progress.steps[1].status).toBe("failed");
    expect(progress.steps[1].error).toBe("fal queue died");
    expect(hasFailedStep(progress)).toBe(true);
  });

  it("supports the retry path: start on a failed step clears its error", () => {
    let progress = initialBatchProgress(steps);
    progress = advanceBatchProgress(progress, { kind: "start", index: 1 });
    progress = advanceBatchProgress(progress, { kind: "fail", index: 1, message: "boom" });
    progress = advanceBatchProgress(progress, { kind: "start", index: 1 });
    expect(progress.steps[1]).toMatchObject<Partial<BatchStepProgress>>({
      status: "running",
      error: null,
    });
  });

  it("counts remaining (unfinished) steps, never completed ones", () => {
    let progress = initialBatchProgress(steps);
    expect(remainingStepCount(progress)).toBe(3);
    progress = advanceBatchProgress(progress, { kind: "start", index: 0 });
    progress = advanceBatchProgress(progress, { kind: "complete", index: 0, resultUrl: "u1" });
    progress = advanceBatchProgress(progress, { kind: "start", index: 1 });
    progress = advanceBatchProgress(progress, { kind: "fail", index: 1, message: "boom" });
    expect(remainingStepCount(progress)).toBe(2);
    expect(hasFailedStep(progress)).toBe(true);
  });

  it("renders running-step progress as 'Region N of total'", () => {
    let progress = initialBatchProgress(steps);
    expect(batchProgressText(progress)).toBeNull();
    progress = advanceBatchProgress(progress, { kind: "start", index: 1 });
    expect(batchProgressText(progress)).toBe("Region 2 of 3");
  });
});
