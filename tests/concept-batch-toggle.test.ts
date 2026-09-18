import { describe, expect, it } from "vitest";

import {
  MAX_BATCH_OBJECTS,
  applyConceptSelectAll,
  applyConceptToggle,
  type BatchSelection,
} from "@/lib/multi-select-batch";

const MASK = "data:image/png;base64,AAAA";

/** A concept-sourced batch entry, as the editor builds it from a toggle. */
function entry(id: string, x: number, y: number, conceptLabel = "sofa"): BatchSelection {
  return { id, point: { x, y }, maskDataUrl: MASK, conceptLabel };
}

describe("applyConceptToggle", () => {
  it("toggle-on adds the entry and the instance index in lockstep", () => {
    const result = applyConceptToggle([], [], entry("sofa:0", 10, 20), 0, true);
    expect(result.rejected).toBeNull();
    expect(result.selections).toHaveLength(1);
    expect(result.selections[0]).toEqual(entry("sofa:0", 10, 20));
    expect(result.selectedInstanceIndices).toEqual([0]);
  });

  it("toggle-on inherits the batch cap from the existing reducer", () => {
    let selections: BatchSelection[] = [];
    let indices: number[] = [];
    for (let i = 0; i < MAX_BATCH_OBJECTS; i++) {
      const step = applyConceptToggle(selections, indices, entry(`sofa:${i}`, i * 100, 0), i, true);
      selections = step.selections;
      indices = step.selectedInstanceIndices;
    }
    expect(selections).toHaveLength(MAX_BATCH_OBJECTS);

    const refused = applyConceptToggle(selections, indices, entry("sofa:5", 9999, 9999), 5, true);
    expect(refused.rejected).toBe("cap");
    // A refused add leaves BOTH pieces unchanged — the instance must not
    // light up on the canvas either.
    expect(refused.selections).toBe(selections);
    expect(refused.selectedInstanceIndices).toEqual(indices);
  });

  it("toggle-on inherits the duplicate-point rule", () => {
    const state = applyConceptToggle([], [], entry("sofa:0", 10.2, 20.6), 0, true);
    // 10.2/10.4 both round to x=10; 20.6/20.9 both round to y=21.
    const refused = applyConceptToggle(
      state.selections,
      state.selectedInstanceIndices,
      entry("lamp:1", 10.4, 20.9),
      1,
      true
    );
    expect(refused.rejected).toBe("duplicate");
    expect(refused.selectedInstanceIndices).toEqual(state.selectedInstanceIndices);
  });

  it("toggle-off removes the entry and the index by id/rank", () => {
    const first = applyConceptToggle([], [], entry("sofa:0", 10, 20), 0, true);
    const second = applyConceptToggle(
      first.selections,
      first.selectedInstanceIndices,
      entry("sofa:1", 200, 20),
      1,
      true
    );
    const off = applyConceptToggle(
      second.selections,
      second.selectedInstanceIndices,
      entry("sofa:0", 10, 20),
      0,
      false
    );
    expect(off.rejected).toBeNull();
    expect(off.selections.map((selection) => selection.id)).toEqual(["sofa:1"]);
    expect(off.selectedInstanceIndices).toEqual([1]);
  });

  it("toggle-off of an absent instance is a no-op", () => {
    const state = applyConceptToggle([], [], entry("sofa:0", 10, 20), 0, true);
    const off = applyConceptToggle(
      state.selections,
      state.selectedInstanceIndices,
      entry("sofa:3", 5, 5),
      3,
      false
    );
    expect(off.selections).toEqual(state.selections);
    expect(off.selectedInstanceIndices).toEqual(state.selectedInstanceIndices);
  });

  it("entries accumulate in toggle order across concepts", () => {
    let state = applyConceptToggle([], [], entry("sofa:0", 10, 20), 0, true);
    state = applyConceptToggle(
      state.selections,
      state.selectedInstanceIndices,
      entry("lamp:1", 200, 20, "lamp"),
      1,
      true
    );
    expect(state.selections.map((selection) => selection.conceptLabel)).toEqual(["sofa", "lamp"]);
  });

  it("does not mutate its inputs", () => {
    const selections = [entry("sofa:0", 10, 20)];
    const indices = [0];
    applyConceptToggle(selections, indices, entry("sofa:1", 200, 20), 1, true);
    expect(selections).toHaveLength(1);
    expect(indices).toEqual([0]);
  });
});

describe("applyConceptSelectAll", () => {
  // Issue #249: "Select all detected" is bulk-toggle-on — same cap, same
  // duplicate-point rule, same lockstep between the batch set and the
  // canvas indices, plus a report of what THIS call added (for per-instance
  // selection_logged events) and whether the cap left instances out.
  const detected = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      instanceIndex: index,
      entry: entry(`sofa:${index}`, index * 100, index * 7),
    }));

  it("selects every detected instance in rank order, lockstep with the indices", () => {
    const result = applyConceptSelectAll([], [], detected(3));
    expect(result.truncated).toBe(false);
    expect(result.selections.map((selection) => selection.id)).toEqual([
      "sofa:0",
      "sofa:1",
      "sofa:2",
    ]);
    expect(result.selectedInstanceIndices).toEqual([0, 1, 2]);
    expect(result.addedInstanceIndices).toEqual([0, 1, 2]);
  });

  it("keeps the best-ranked MAX_BATCH_OBJECTS and reports truncation", () => {
    const result = applyConceptSelectAll([], [], detected(7));
    expect(result.selections).toHaveLength(MAX_BATCH_OBJECTS);
    expect(result.selectedInstanceIndices).toEqual([0, 1, 2, 3, 4]);
    expect(result.addedInstanceIndices).toEqual([0, 1, 2, 3, 4]);
    expect(result.truncated).toBe(true);
  });

  it("is idempotent — already-selected instances add nothing", () => {
    const first = applyConceptSelectAll([], [], detected(3));
    const again = applyConceptSelectAll(
      first.selections,
      first.selectedInstanceIndices,
      detected(3)
    );
    expect(again.selections).toEqual(first.selections);
    expect(again.selectedInstanceIndices).toEqual(first.selectedInstanceIndices);
    expect(again.addedInstanceIndices).toEqual([]);
    expect(again.truncated).toBe(false);
  });

  it("fills only the remaining headroom when partially selected", () => {
    const base = applyConceptSelectAll([], [], detected(4));
    const result = applyConceptSelectAll(base.selections, base.selectedInstanceIndices, detected(7));
    expect(result.selections).toHaveLength(MAX_BATCH_OBJECTS);
    // Instance 4 is the only newcomer; 5 and 6 are left out by the cap.
    expect(result.addedInstanceIndices).toEqual([4]);
    expect(result.selectedInstanceIndices).toEqual([0, 1, 2, 3, 4]);
    expect(result.truncated).toBe(true);
  });

  it("skips duplicate-point entries without breaking the rest", () => {
    const result = applyConceptSelectAll(
      [],
      [],
      detected(1).concat([
        { instanceIndex: 1, entry: entry("lamp:1", 0.4, 0.4, "lamp") }, // rounds to sofa:0's seed (0,0)
        { instanceIndex: 2, entry: entry("rug:2", 500, 500, "rug") },
      ])
    );
    expect(result.selections.map((selection) => selection.id)).toEqual(["sofa:0", "rug:2"]);
    expect(result.selectedInstanceIndices).toEqual([0, 2]);
    expect(result.addedInstanceIndices).toEqual([0, 2]);
    expect(result.truncated).toBe(false);
  });

  it("selects nothing from an empty detection", () => {
    const result = applyConceptSelectAll([], [], []);
    expect(result.selections).toEqual([]);
    expect(result.selectedInstanceIndices).toEqual([]);
    expect(result.addedInstanceIndices).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("does not mutate its inputs", () => {
    const selections = [entry("sofa:0", 10, 20)];
    const indices = [0];
    applyConceptSelectAll(selections, indices, detected(7));
    expect(selections).toHaveLength(1);
    expect(indices).toEqual([0]);
  });
});
