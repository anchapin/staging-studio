import { describe, expect, it } from "vitest";

import {
  MAX_BATCH_REGIONS,
  applyConceptSelectAll,
  applyConceptToggle,
  masksWithinProximity,
  type BatchSelection,
  type ConceptSelectAllCandidate,
  type InstanceMaskGrid,
} from "@/lib/multi-select-batch";

const MASK = "data:image/png;base64,AAAA";

/** A concept-sourced batch entry, as the editor builds it from a toggle. */
function entry(id: string, x: number, y: number, conceptLabel = "sofa"): BatchSelection {
  return { id, point: { x, y }, maskDataUrl: MASK, conceptLabel };
}

/** Builds an instance grid with single painted cells (fixtures live on one row). */
function cellGrid(width: number, height: number, cells: Array<[number, number]>): InstanceMaskGrid {
  const grid = new Uint8Array(width * height);
  for (const [x, y] of cells) grid[y * width + x] = 1;
  return { grid, width, height };
}

/** Grids for the toggle-merge fixtures: one painted cell per instance, on row 0. */
function gridMapFor(width: number, columns: number[]): Map<number, InstanceMaskGrid> {
  const map = new Map<number, InstanceMaskGrid>();
  columns.forEach((column, index) => map.set(index, cellGrid(width, 1, [[column, 0]])));
  return map;
}

describe("applyConceptToggle", () => {
  it("toggle-on adds the entry and the instance index in lockstep", () => {
    const result = applyConceptToggle([], [], entry("sofa:0", 10, 20), 0, true);
    expect(result.rejected).toBeNull();
    expect(result.selections).toHaveLength(1);
    expect(result.selections[0]).toEqual({ ...entry("sofa:0", 10, 20), memberInstanceIndices: [0] });
    expect(result.selectedInstanceIndices).toEqual([0]);
  });

  it("toggle-on inherits the batch cap from the existing reducer", () => {
    let selections: BatchSelection[] = [];
    let indices: number[] = [];
    for (let i = 0; i < MAX_BATCH_REGIONS; i++) {
      const step = applyConceptToggle(selections, indices, entry(`sofa:${i}`, i * 100, 0), i, true);
      selections = step.selections;
      indices = step.selectedInstanceIndices;
    }
    expect(selections).toHaveLength(MAX_BATCH_REGIONS);

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

describe("proximity merging (issue #252 D2)", () => {
  it("masksWithinProximity: 4px gap is within MERGE_PROXIMITY_PX=5, 6px is not", () => {
    const a = cellGrid(8, 1, [[0, 0]]);
    const near = cellGrid(8, 1, [[4, 0]]); // nearest painted cells 4 apart
    const far = cellGrid(8, 1, [[6, 0]]); // 6 apart
    expect(masksWithinProximity(a.grid, near.grid, 8, 1, 5)).toBe(true);
    expect(masksWithinProximity(a.grid, far.grid, 8, 1, 5)).toBe(false);
    // Touching masks merge trivially.
    const touching = cellGrid(8, 1, [[1, 0]]);
    expect(masksWithinProximity(a.grid, touching.grid, 8, 1, 5)).toBe(true);
  });

  it("toggle-on within 5 grid px merges into the existing region (one row)", () => {
    const grids = gridMapFor(16, [0, 4]); // 4px apart → merge
    const first = applyConceptToggle([], [], entry("sofa:0", 0, 0), 0, true, {
      instanceGrids: grids,
    });
    const second = applyConceptToggle(
      first.selections,
      first.selectedInstanceIndices,
      entry("sofa:1", 4, 0),
      1,
      true,
      { instanceGrids: grids }
    );
    expect(second.rejected).toBeNull();
    // One region row, carrying BOTH member instances.
    expect(second.selections).toHaveLength(1);
    expect(second.selections[0]?.memberInstanceIndices).toEqual([0, 1]);
    expect(second.selectedInstanceIndices).toEqual([0, 1]);
  });

  it("toggle-on beyond the proximity threshold adds a separate region", () => {
    const grids = gridMapFor(16, [0, 6]); // 6px apart → no merge
    const first = applyConceptToggle([], [], entry("sofa:0", 0, 0), 0, true, {
      instanceGrids: grids,
    });
    const second = applyConceptToggle(
      first.selections,
      first.selectedInstanceIndices,
      entry("sofa:1", 6, 0),
      1,
      true,
      { instanceGrids: grids }
    );
    expect(second.rejected).toBeNull();
    expect(second.selections).toHaveLength(2);
    expect(second.selections.map((selection) => selection.id)).toEqual(["sofa:0", "sofa:1"]);
  });

  it("merging is transitive through region membership (chains fuse)", () => {
    const grids = gridMapFor(24, [0, 4, 8]); // 0↔4 near, 4↔8 near, 0↔8 far
    let state = applyConceptToggle([], [], entry("sofa:0", 0, 0), 0, true, {
      instanceGrids: grids,
    });
    state = applyConceptToggle(
      state.selections,
      state.selectedInstanceIndices,
      entry("sofa:1", 4, 0),
      1,
      true,
      { instanceGrids: grids }
    );
    state = applyConceptToggle(
      state.selections,
      state.selectedInstanceIndices,
      entry("sofa:2", 8, 0),
      2,
      true,
      { instanceGrids: grids }
    );
    expect(state.selections).toHaveLength(1);
    expect(state.selections[0]?.memberInstanceIndices).toEqual([0, 1, 2]);
  });

  it("duplicate-point refusal takes precedence over merging", () => {
    const grids = gridMapFor(16, [0, 0]); // same cell → same point AND near
    const first = applyConceptToggle([], [], entry("sofa:0", 0, 0), 0, true, {
      instanceGrids: grids,
    });
    const second = applyConceptToggle(
      first.selections,
      first.selectedInstanceIndices,
      entry("sofa:1", 0.4, 0), // rounds to sofa:0's point
      1,
      true,
      { instanceGrids: grids }
    );
    expect(second.rejected).toBe("duplicate");
    expect(second.selections).toHaveLength(1);
    expect(second.selections[0]?.memberInstanceIndices).toEqual([0]);
  });

  it("cap refusal still applies when proximity-merging is possible", () => {
    // 5 regions already exist (all far apart, no merging); a 6th toggle near
    // one of them merges into that region — merging never adds a row, so the
    // cap does not refuse it. A 6th toggle FAR from everything is refused.
    const grids = new Map<number, InstanceMaskGrid>();
    let state = {
      selections: [] as BatchSelection[],
      selectedInstanceIndices: [] as number[],
    };
    for (let i = 0; i < MAX_BATCH_REGIONS; i++) {
      grids.set(i, cellGrid(64, 1, [[i * 12, 0]]));
      state = applyConceptToggle(
        state.selections,
        state.selectedInstanceIndices,
        entry(`sofa:${i}`, i * 12, 0),
        i,
        true,
        { instanceGrids: grids }
      );
    }
    expect(state.selections).toHaveLength(MAX_BATCH_REGIONS);
    // Instance 5 sits 4px from instance 0's mask → merges into region 0.
    grids.set(5, cellGrid(64, 1, [[4, 0]]));
    const merged = applyConceptToggle(
      state.selections,
      state.selectedInstanceIndices,
      entry("sofa:5", 4, 0),
      5,
      true,
      { instanceGrids: grids }
    );
    expect(merged.rejected).toBeNull();
    expect(merged.selections).toHaveLength(MAX_BATCH_REGIONS);
    expect(merged.selections[0]?.memberInstanceIndices).toEqual([0, 5]);
  });
});

describe("applyConceptSelectAll", () => {
  // Issue #249/#252: "Select all detected" clusters detections into regions
  // via a proximity graph + connected components (edge = masks within
  // MERGE_PROXIMITY_PX), then selects components up to the region cap.
  // Candidates arrive in score-ranked order and carry their mask-canvas grid
  // (for proximity edges) and detection score (for component ranking).
  const detected = (count: number): ConceptSelectAllCandidate[] =>
    Array.from({ length: count }, (_, index) => ({
      instanceIndex: index,
      entry: entry(`sofa:${index}`, index * 100, index * 7),
      // Rank-descending scores so component ranking keeps the best-ranked.
      score: 100 - index,
      grid: cellGrid(count * 100, 1, [[index * 100, 0]]),
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

  it("keeps the best-ranked MAX_BATCH_REGIONS and reports truncation", () => {
    const result = applyConceptSelectAll([], [], detected(7));
    expect(result.selections).toHaveLength(MAX_BATCH_REGIONS);
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
    expect(result.selections).toHaveLength(MAX_BATCH_REGIONS);
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
        // rounds to sofa:0's seed (0,0) → duplicate, skipped before clustering
        {
          instanceIndex: 1,
          entry: entry("lamp:1", 0.4, 0.4, "lamp"),
          score: 80,
          grid: cellGrid(1000, 1, [[500, 0]]),
        },
        {
          instanceIndex: 2,
          entry: entry("rug:2", 500, 500, "rug"),
          score: 70,
          grid: cellGrid(1000, 1000, [[500, 500]]),
        },
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

describe("select-all connected components (issue #252 D2)", () => {
  it("clusters nearby detections into one region: 12 instances → 3 regions, all selected", () => {
    // Three fused clusters of 4 (members 4px apart, clusters 500px apart).
    // The OLD top-5 rule would truncate; components select everything.
    const candidates: ConceptSelectAllCandidate[] = Array.from(
      { length: 12 },
      (_, index) => {
        const cluster = Math.floor(index / 4);
        const column = (cluster % 2) * 500 + (index % 4) * 4;
        const row = Math.floor(cluster / 2) * 500;
        return {
          instanceIndex: index,
          entry: entry(`sofa:${index}`, column, row),
          score: 100 - index,
          grid: cellGrid(1000, 1000, [[column, row]]),
        };
      }
    );
    const result = applyConceptSelectAll([], [], candidates);
    expect(result.truncated).toBe(false);
    expect(result.selections).toHaveLength(3);
    expect(result.selections.map((selection) => selection.memberInstanceIndices)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11],
    ]);
    expect(result.selectedInstanceIndices).toHaveLength(12);
    expect(result.addedInstanceIndices).toHaveLength(12);
  });

  it("keeps the top 5 components by member score sum and reports truncation", () => {
    // 7 components (all far apart). Two weak components (low scores) must
    // lose against five strong ones even though a weak one is rank-earlier.
    const candidates: ConceptSelectAllCandidate[] = [
      // rank 0: strong singleton
      { instanceIndex: 0, entry: entry("sofa:0", 0, 0), score: 90, grid: cellGrid(1000, 1, [[0, 0]]) },
      // ranks 1-2: a fused PAIR near each other (score sums to 170)
      { instanceIndex: 1, entry: entry("sofa:1", 100, 0), score: 85, grid: cellGrid(1000, 1, [[100, 0]]) },
      { instanceIndex: 2, entry: entry("sofa:2", 104, 0), score: 85, grid: cellGrid(1000, 1, [[104, 0]]) },
      // ranks 3-6: singletons with descending scores
      { instanceIndex: 3, entry: entry("sofa:3", 200, 0), score: 60, grid: cellGrid(1000, 1, [[200, 0]]) },
      { instanceIndex: 4, entry: entry("sofa:4", 300, 0), score: 50, grid: cellGrid(1000, 1, [[300, 0]]) },
      { instanceIndex: 5, entry: entry("sofa:5", 400, 0), score: 40, grid: cellGrid(1000, 1, [[400, 0]]) },
      { instanceIndex: 6, entry: entry("sofa:6", 500, 0), score: 30, grid: cellGrid(1000, 1, [[500, 0]]) },
    ];
    const result = applyConceptSelectAll([], [], candidates);
    expect(result.truncated).toBe(true);
    // 5 regions kept, ranked by member score sum: {1,2}=170, {0}=90,
    // {3}=60, {4}=50, {5}=40 — {6} (weakest) left out.
    expect(result.selections).toHaveLength(5);
    expect(result.selections.map((selection) => selection.id)).toEqual([
      "sofa:1",
      "sofa:0",
      "sofa:3",
      "sofa:4",
      "sofa:5",
    ]);
    expect(result.selections[0]?.memberInstanceIndices).toEqual([1, 2]);
    expect(result.selectedInstanceIndices).toEqual([1, 2, 0, 3, 4, 5]);
    expect(result.addedInstanceIndices).toEqual([1, 2, 0, 3, 4, 5]);
  });
});
