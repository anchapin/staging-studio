import { describe, expect, it } from "vitest";

import {
  MAX_BATCH_OBJECTS,
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
