import { describe, expect, it } from "vitest";

import {
  MAX_BATCH_REGIONS,
  advanceBatchProgress,
  batchProgressText,
  batchStepLabel,
  buildBatchPlan,
  hasFailedStep,
  initialBatchProgress,
  reduceSelectionSet,
  remainingStepCount,
  unionMaskBuffers,
  type BatchSelection,
  type BatchStepProgress,
} from "@/lib/multi-select-batch";

const MASK_A = "data:image/png;base64,AAAA";
const MASK_B = "data:image/png;base64,BBBBBBBB";
const MASK_C = "data:image/png;base64,CCCC";

function selection(id: string, x: number, y: number, maskDataUrl = MASK_A): BatchSelection {
  return { id, point: { x, y }, maskDataUrl };
}

/** 2×2 RGBA helper: painted cells are white, unpainted black, alpha 255. */
function buffer(
  paintedCells: number[],
  { width = 2, height = 2, value = 255 }: { width?: number; height?: number; value?: number } = {}
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const cell of paintedCells) {
    const o = cell * 4;
    data[o] = value;
    data[o + 1] = value;
    data[o + 2] = value;
    data[o + 3] = 255;
  }
  return { width, height, data };
}

describe("MAX_BATCH_REGIONS", () => {
  it("caps batches at five regions", () => {
    expect(MAX_BATCH_REGIONS).toBe(5);
  });
});

describe("reduceSelectionSet", () => {
  it("adds selections in click order", () => {
    const reduced = reduceSelectionSet([], { type: "add", selection: selection("a", 10, 20) });
    expect(reduced.rejected).toBeNull();
    expect(reduced.selections).toHaveLength(1);
    expect(reduced.selections[0].id).toBe("a");
  });

  it("refuses adds beyond the cap without changing the set", () => {
    let state: BatchSelection[] = [];
    for (let i = 0; i < MAX_BATCH_REGIONS; i++) {
      state = reduceSelectionSet(state, { type: "add", selection: selection(`s${i}`, i * 100, 0) })
        .selections;
    }
    expect(state).toHaveLength(MAX_BATCH_REGIONS);

    const reduced = reduceSelectionSet(state, {
      type: "add",
      selection: selection("extra", 9999, 9999),
    });
    expect(reduced.rejected).toBe("cap");
    expect(reduced.selections).toBe(state);
  });

  it("refuses a duplicate click on the same rounded point", () => {
    const state = reduceSelectionSet([], { type: "add", selection: selection("a", 10, 20) })
      .selections;
    const reduced = reduceSelectionSet(state, { type: "add", selection: selection("b", 10, 20) });
    expect(reduced.rejected).toBe("duplicate");
    expect(reduced.selections).toBe(state);
  });

  it("rounds sub-pixel neighbours onto the same duplicate key", () => {
    // 10.2/10.4 both round to x=10; 20.6/20.9 both round to y=21.
    const state = reduceSelectionSet([], { type: "add", selection: selection("a", 10.2, 20.6) })
      .selections;
    const reduced = reduceSelectionSet(state, { type: "add", selection: selection("b", 10.4, 20.9) });
    expect(reduced.rejected).toBe("duplicate");
  });

  it("allows distinct points", () => {
    const state = reduceSelectionSet([], { type: "add", selection: selection("a", 10, 20) })
      .selections;
    const reduced = reduceSelectionSet(state, { type: "add", selection: selection("b", 200, 20) });
    expect(reduced.rejected).toBeNull();
    expect(reduced.selections.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("removeLast drops the most recent selection", () => {
    let state = reduceSelectionSet([], { type: "add", selection: selection("a", 0, 0) }).selections;
    state = reduceSelectionSet(state, { type: "add", selection: selection("b", 50, 50) }).selections;
    const reduced = reduceSelectionSet(state, { type: "removeLast" });
    expect(reduced.selections.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("removeLast on an empty set stays empty", () => {
    expect(reduceSelectionSet([], { type: "removeLast" }).selections).toEqual([]);
  });

  it("remove by id keeps the relative order of the rest", () => {
    let state = reduceSelectionSet([], { type: "add", selection: selection("a", 0, 0) }).selections;
    state = reduceSelectionSet(state, { type: "add", selection: selection("b", 50, 50) }).selections;
    state = reduceSelectionSet(state, { type: "add", selection: selection("c", 90, 90) }).selections;
    const reduced = reduceSelectionSet(state, { type: "remove", id: "b" });
    expect(reduced.selections.map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("clear empties the set", () => {
    const state = reduceSelectionSet([], { type: "add", selection: selection("a", 0, 0) })
      .selections;
    expect(reduceSelectionSet(state, { type: "clear" }).selections).toEqual([]);
  });
});

describe("unionMaskBuffers", () => {
  it("returns null for an empty input", () => {
    expect(unionMaskBuffers([])).toBeNull();
  });

  it("returns null for non-positive dimensions", () => {
    expect(unionMaskBuffers([{ width: 0, height: 4, data: new Uint8ClampedArray(0) }])).toBeNull();
  });

  it("returns null when buffer dimensions disagree", () => {
    expect(unionMaskBuffers([buffer([0]), { width: 3, height: 2, data: new Uint8ClampedArray(24) }]))
      .toBeNull();
  });

  it("keeps a single mask's painted cells and paints alpha everywhere", () => {
    const union = unionMaskBuffers([buffer([0, 3])]);
    expect(union).not.toBeNull();
    expect(union?.width).toBe(2);
    expect(union?.height).toBe(2);
    const data = union!.data;
    // Cell 0 painted white; cell 1 unpainted black; alpha opaque everywhere.
    expect([data[0], data[1], data[2], data[3]]).toEqual([255, 255, 255, 255]);
    expect([data[4], data[5], data[6], data[7]]).toEqual([0, 0, 0, 255]);
    expect([data[12], data[13], data[14], data[15]]).toEqual([255, 255, 255, 255]);
  });

  it("ORs painted cells from every buffer", () => {
    const union = unionMaskBuffers([buffer([0]), buffer([3]), buffer([0, 1])]);
    expect(union).not.toBeNull();
    const data = union!.data;
    const painted = [];
    for (let cell = 0; cell < 4; cell++) {
      if (data[cell * 4] === 255) painted.push(cell);
    }
    expect(painted).toEqual([0, 1, 3]);
  });

  it("uses the mask editor's painted-pixel semantics (alpha and luminance)", () => {
    // Luminance 127 (< 128) is not painted even at full alpha.
    const dim = unionMaskBuffers([
      { width: 1, height: 1, data: new Uint8ClampedArray([127, 127, 127, 255]) },
    ]);
    expect(dim!.data[0]).toBe(0);
    // Luminance 128 at full alpha is painted.
    const bright = unionMaskBuffers([
      { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]) },
    ]);
    expect(bright!.data[0]).toBe(255);
    // Transparent pixels are never painted regardless of color.
    const transparent = unionMaskBuffers([
      { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 127]) },
    ]);
    expect(transparent!.data[0]).toBe(0);
  });

  it("does not mutate its inputs", () => {
    const input = buffer([1]);
    const snapshot = Uint8ClampedArray.from(input.data);
    unionMaskBuffers([input]);
    expect(Array.from(input.data)).toEqual(Array.from(snapshot));
  });
});

describe("batchStepLabel", () => {
  it("produces 1-based labels", () => {
    expect(batchStepLabel(0)).toBe("Object 1");
    expect(batchStepLabel(4)).toBe("Object 5");
  });
});

describe("buildBatchPlan", () => {
  const selections = [selection("a", 1, 1, MASK_A), selection("b", 2, 2, MASK_B)];

  it("refuses an empty selection set", () => {
    const result = buildBatchPlan({
      selections: [],
      mode: "thematic",
      thematicPrompt: "x",
      perObjectPrompts: [],
      unionMaskDataUrl: MASK_C,
    });
    expect(result).toEqual({
      ok: false,
      error: "Select at least one object before running a batch.",
    });
  });

  it("builds a thematic plan over the union mask with a trimmed prompt", () => {
    const result = buildBatchPlan({
      selections,
      mode: "thematic",
      thematicPrompt: "  restage the furniture  ",
      perObjectPrompts: [],
      unionMaskDataUrl: MASK_C,
    });
    expect(result).toEqual({
      ok: true,
      plan: { kind: "thematic", maskDataUrl: MASK_C, promptDirectives: "restage the furniture" },
    });
  });

  it("refuses a thematic plan without the composed union mask", () => {
    const result = buildBatchPlan({
      selections,
      mode: "thematic",
      thematicPrompt: "x",
      perObjectPrompts: [],
      unionMaskDataUrl: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("combined mask");
  });

  it("refuses an empty or whitespace thematic prompt", () => {
    const result = buildBatchPlan({
      selections,
      mode: "thematic",
      thematicPrompt: "   ",
      perObjectPrompts: [],
      unionMaskDataUrl: MASK_C,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Thematic prompt");
  });

  it("refuses a thematic prompt beyond the route's 2000-character bound", () => {
    const result = buildBatchPlan({
      selections,
      mode: "thematic",
      thematicPrompt: "x".repeat(2001),
      perObjectPrompts: [],
      unionMaskDataUrl: MASK_C,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("2000-character");
  });

  it("builds ordered per-object steps pairing each mask with its prompt", () => {
    const result = buildBatchPlan({
      selections,
      mode: "per-object",
      thematicPrompt: "",
      perObjectPrompts: ["futon for the couch", "rug to match"],
      unionMaskDataUrl: MASK_C,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.plan.kind === "per-object") {
      expect(result.plan.steps).toEqual([
        {
          selectionId: "a",
          label: "Object 1",
          maskDataUrl: MASK_A,
          promptDirectives: "futon for the couch",
        },
        {
          selectionId: "b",
          label: "Object 2",
          maskDataUrl: MASK_B,
          promptDirectives: "rug to match",
        },
      ]);
    }
  });

  it("refuses per-object prompts whose length disagrees with the selection set", () => {
    const result = buildBatchPlan({
      selections,
      mode: "per-object",
      thematicPrompt: "",
      perObjectPrompts: ["only one"],
      unionMaskDataUrl: MASK_C,
    });
    expect(result).toEqual({
      ok: false,
      error: "Every selected object needs its own prompt.",
    });
  });

  it("names the first object with an invalid per-object prompt", () => {
    const result = buildBatchPlan({
      selections,
      mode: "per-object",
      thematicPrompt: "",
      perObjectPrompts: ["ok", "   "],
      unionMaskDataUrl: MASK_C,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Object 2");
  });

  it("refuses an over-long per-object prompt", () => {
    const result = buildBatchPlan({
      selections,
      mode: "per-object",
      thematicPrompt: "",
      perObjectPrompts: ["ok", "x".repeat(2001)],
      unionMaskDataUrl: MASK_C,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Object 2");
  });
});

describe("per-object progress state machine", () => {
  const steps = [
    { selectionId: "a", label: "Object 1", maskDataUrl: MASK_A, promptDirectives: "p1" },
    { selectionId: "b", label: "Object 2", maskDataUrl: MASK_B, promptDirectives: "p2" },
    { selectionId: "c", label: "Object 3", maskDataUrl: MASK_C, promptDirectives: "p3" },
  ];

  it("starts with every step pending", () => {
    const progress = initialBatchProgress(steps);
    expect(progress.steps.map((step) => step.status)).toEqual(["pending", "pending", "pending"]);
    expect(progress.steps.map((step) => step.label)).toEqual(["Object 1", "Object 2", "Object 3"]);
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

  it("renders running-step progress as 'Object N of total'", () => {
    let progress = initialBatchProgress(steps);
    expect(batchProgressText(progress)).toBeNull();
    progress = advanceBatchProgress(progress, { kind: "start", index: 1 });
    expect(batchProgressText(progress)).toBe("Object 2 of 3");
  });
});
