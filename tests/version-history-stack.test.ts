import { describe, expect, it } from "vitest";
import {
  planVersionRestore,
  type VersionHistoryStackState,
} from "@/lib/version-history-stack";

/**
 * Issue #699: version-history pills undo/redo stack discipline.
 *
 * Pins the pure stack state machine in lib/version-history-stack.ts 1:1 —
 * the transitions version-history-pills.tsx applies optimistically while a
 * restore is in flight and rolls back on failure:
 * - undo seeds the redo stack WITHOUT wiping it (redo was impossible before
 *   #699 because the shared restore path cleared redoStack after undo had
 *   just pushed the redo entry)
 * - redo mirrors that for the undo stack (the old shared path also pushed
 *   the outgoing URL twice, duplicating undo entries)
 * - only a direct pill pick clears the redo stack
 * - a failed restore rolls stacks AND currentIndex back to the pre-click
 *   snapshot (the state object passed in at click time)
 */

/** Newest-first URL list, mirroring getInpaintVersions order. */
const VERSION_URLS: readonly string[] = ["v3", "v2", "v1"];
const idx = (url: string) => VERSION_URLS.indexOf(url);

describe("planVersionRestore — undo transitions", () => {
  it("pops the undo target and seeds redo without clearing it (#699)", () => {
    const state: VersionHistoryStackState = {
      undoStack: ["v1", "v2"],
      redoStack: [],
      currentIndex: idx("v3"),
    };
    const plan = planVersionRestore(state, VERSION_URLS, { kind: "undo" }, "v3");
    expect(plan).toEqual({
      targetUrl: "v2",
      targetIndex: idx("v2"),
      next: {
        undoStack: ["v1"],
        // The redo entry undo just seeded must survive (#699 regression).
        redoStack: ["v3"],
        currentIndex: idx("v2"),
      },
    });
  });

  it("keeps earlier redo entries alive across an undo", () => {
    const state: VersionHistoryStackState = {
      undoStack: ["v1"],
      redoStack: ["older-redo"],
      currentIndex: idx("v3"),
    };
    const plan = planVersionRestore(state, VERSION_URLS, { kind: "undo" }, "v3");
    expect(plan?.next.redoStack).toEqual(["older-redo", "v3"]);
  });

  it("is a no-op when the undo stack is empty", () => {
    const state: VersionHistoryStackState = {
      undoStack: [],
      redoStack: [],
      currentIndex: 0,
    };
    expect(
      planVersionRestore(state, VERSION_URLS, { kind: "undo" }, "v3")
    ).toBeNull();
  });

  it("is a no-op when the undo target is missing from the version list", () => {
    // Pre-#699 the stacks were mutated before the URL→version lookup, so an
    // unresolvable target left them corrupted. null means "touch nothing".
    const state: VersionHistoryStackState = {
      undoStack: ["gone"],
      redoStack: ["keep"],
      currentIndex: idx("v3"),
    };
    expect(
      planVersionRestore(state, VERSION_URLS, { kind: "undo" }, "v3")
    ).toBeNull();
  });
});

describe("planVersionRestore — redo transitions", () => {
  it("pops the redo target and pushes the outgoing URL onto undo exactly once", () => {
    const state: VersionHistoryStackState = {
      undoStack: ["v1"],
      redoStack: ["v3"],
      currentIndex: idx("v2"),
    };
    const plan = planVersionRestore(state, VERSION_URLS, { kind: "redo" }, "v2");
    // Before #699 the shared restore path pushed the outgoing URL a second
    // time (handleRedo + handleRestore both pushed), duplicating undo entries.
    expect(plan).toEqual({
      targetUrl: "v3",
      targetIndex: idx("v3"),
      next: {
        undoStack: ["v1", "v2"],
        redoStack: [],
        currentIndex: idx("v3"),
      },
    });
  });

  it("skips the undo push when no URL is current", () => {
    const state: VersionHistoryStackState = {
      undoStack: ["v1"],
      redoStack: ["v3"],
      currentIndex: idx("v2"),
    };
    const plan = planVersionRestore(state, VERSION_URLS, { kind: "redo" }, null);
    expect(plan?.next).toEqual({
      undoStack: ["v1"],
      redoStack: [],
      currentIndex: idx("v3"),
    });
  });

  it("is a no-op when the redo stack is empty", () => {
    const state: VersionHistoryStackState = {
      undoStack: ["v1"],
      redoStack: [],
      currentIndex: idx("v2"),
    };
    expect(
      planVersionRestore(state, VERSION_URLS, { kind: "redo" }, "v2")
    ).toBeNull();
  });
});

describe("planVersionRestore — direct pill pick", () => {
  it("pushes the outgoing URL onto undo and clears redo (new action)", () => {
    const state: VersionHistoryStackState = {
      undoStack: ["v1"],
      redoStack: ["older-redo"],
      currentIndex: idx("v3"),
    };
    const plan = planVersionRestore(
      state,
      VERSION_URLS,
      { kind: "direct", targetIndex: idx("v2") },
      "v3"
    );
    expect(plan).toEqual({
      targetUrl: "v2",
      targetIndex: idx("v2"),
      next: {
        undoStack: ["v1", "v3"],
        // Only a pick outside undo/redo invalidates the redo history.
        redoStack: [],
        currentIndex: idx("v2"),
      },
    });
  });

  it("is a no-op when picking the version that is already current", () => {
    const state: VersionHistoryStackState = {
      undoStack: [],
      redoStack: ["v2"],
      currentIndex: idx("v3"),
    };
    expect(
      planVersionRestore(
        state,
        VERSION_URLS,
        { kind: "direct", targetIndex: idx("v3") },
        "v3"
      )
    ).toBeNull();
  });

  it("picks a first version without seeding undo when no URL is current", () => {
    const state: VersionHistoryStackState = {
      undoStack: [],
      redoStack: [],
      currentIndex: 0,
    };
    const plan = planVersionRestore(
      state,
      VERSION_URLS,
      { kind: "direct", targetIndex: idx("v1") },
      null
    );
    expect(plan?.next).toEqual({
      undoStack: [],
      redoStack: [],
      currentIndex: idx("v1"),
    });
  });

  it("is a no-op for an out-of-range target index", () => {
    const state: VersionHistoryStackState = {
      undoStack: [],
      redoStack: [],
      currentIndex: 0,
    };
    expect(
      planVersionRestore(
        state,
        VERSION_URLS,
        { kind: "direct", targetIndex: 99 },
        "v3"
      )
    ).toBeNull();
  });
});

describe("undo → redo round trip (issue #699 acceptance)", () => {
  it("restores the original image and keeps redo usable after undo", () => {
    let currentUrl = "v3";
    let state: VersionHistoryStackState = {
      undoStack: ["v1", "v2"],
      redoStack: [],
      currentIndex: idx("v3"),
    };

    // Undo: v3 → v2
    const undoPlan = planVersionRestore(
      state,
      VERSION_URLS,
      { kind: "undo" },
      currentUrl
    );
    expect(undoPlan).not.toBeNull();
    state = undoPlan!.next;
    currentUrl = undoPlan!.targetUrl;
    expect(currentUrl).toBe("v2");
    // The redo affordance must stay enabled after an undo (#699: the old
    // shared restore path wiped this entry, making redo impossible).
    expect(state.redoStack).toEqual(["v3"]);

    // Redo: v2 → back to the original image
    const redoPlan = planVersionRestore(
      state,
      VERSION_URLS,
      { kind: "redo" },
      currentUrl
    );
    expect(redoPlan).not.toBeNull();
    expect(redoPlan!.targetUrl).toBe("v3");
    state = redoPlan!.next;
    currentUrl = redoPlan!.targetUrl;
    expect(currentUrl).toBe("v3");
    // Round trip lands back on the original selection state.
    expect(state).toEqual({
      undoStack: ["v1", "v2"],
      redoStack: [],
      currentIndex: idx("v3"),
    });
  });
});

describe("restore failure rollback (issue #699 acceptance)", () => {
  // Mirrors runRestore in version-history-pills.tsx: apply plan.next
  // optimistically, and when the server returns failure, re-apply the
  // pre-click snapshot (the exact state object passed to planVersionRestore).
  it("rolls stacks and currentIndex back to the pre-click state on a failed undo", () => {
    const before: VersionHistoryStackState = {
      undoStack: ["v3"],
      redoStack: [],
      currentIndex: idx("v2"),
    };
    const currentUrl: string | null = "v2";
    let live = before;

    const plan = planVersionRestore(live, VERSION_URLS, { kind: "undo" }, currentUrl);
    expect(plan).not.toBeNull();

    // Optimistic apply — the UI really does diverge while in flight…
    live = plan!.next;
    expect(live).toEqual({
      undoStack: [],
      redoStack: ["v2"],
      currentIndex: idx("v3"),
    });
    expect(live).not.toEqual(before);

    // …server rejects: the component re-applies the snapshot verbatim and
    // onVersionChange never fires, so currentUrl stays put.
    live = before;
    expect(live).toEqual({
      undoStack: ["v3"],
      redoStack: [], // no phantom redo entry from the failed undo
      currentIndex: idx("v2"),
    });
    expect(currentUrl).toBe("v2");

    // And the user can still retry the undo afterwards.
    const retry = planVersionRestore(live, VERSION_URLS, { kind: "undo" }, currentUrl);
    expect(retry?.targetUrl).toBe("v3");
  });

  it("rolls a failed direct pick back, restoring the redo stack the pick would have cleared", () => {
    const before: VersionHistoryStackState = {
      undoStack: [],
      redoStack: ["v3"],
      currentIndex: idx("v1"),
    };
    let live = before;

    const plan = planVersionRestore(
      live,
      VERSION_URLS,
      { kind: "direct", targetIndex: idx("v2") },
      "v1"
    );
    expect(plan).not.toBeNull();

    // Optimistic apply clears redo (new action)…
    live = plan!.next;
    expect(live.redoStack).toEqual([]);

    // …but the failure rollback brings it back along with everything else.
    live = before;
    expect(live).toEqual({
      undoStack: [],
      redoStack: ["v3"],
      currentIndex: idx("v1"),
    });
  });
});
