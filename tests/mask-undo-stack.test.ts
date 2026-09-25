import { describe, it, expect } from "vitest";
import {
  MAX_MASK_UNDO_DEPTH,
  emptyMaskUndoHistory,
  resetMaskUndoHistory,
  canUndoMask,
  maskUndoCount,
  pushMaskSnapshot,
  undoMaskSnapshot,
  redoMaskSnapshot,
  type MaskUndoHistory,
} from "@/lib/mask-undo-stack";

/**
 * Issue #694: pins the mask editor's undo/redo history semantics, extracted
 * from inpaint-mask-canvas.tsx (originally issue #378). Snapshots in these
 * tests stand in for the PNG data URLs the component captures via
 * `canvas.toDataURL()` before each destructive operation.
 */

const snapshot = (label: string) => `data:image/png;base64,${label}`;

/** Simulates the component's interleaved capture sites: stroke, fill, clear, paste. */
function historyFrom(labels: string[]): MaskUndoHistory {
  return labels.reduce<MaskUndoHistory>(
    (history, label) => pushMaskSnapshot(history, snapshot(label)),
    emptyMaskUndoHistory()
  );
}

describe("pushMaskSnapshot", () => {
  it("records before-operation snapshots and grows the undo count", () => {
    const history = historyFrom(["before-stroke", "before-fill"]);
    expect(maskUndoCount(history)).toBe(2);
    expect(history.undo).toEqual([snapshot("before-stroke"), snapshot("before-fill")]);
    expect(canUndoMask(history)).toBe(true);
  });

  it("treats a failed capture (null) as a no-op, like the old null guard", () => {
    const history = historyFrom(["before-stroke"]);
    expect(pushMaskSnapshot(history, null)).toBe(history);
    expect(maskUndoCount(history)).toBe(1);
  });

  it("does not mutate the input history", () => {
    const history = historyFrom(["a"]);
    const before = [...history.undo];
    pushMaskSnapshot(history, snapshot("b"));
    expect([...history.undo]).toEqual(before);
  });
});

describe("cap enforcement", () => {
  it("caps the stack at MAX_MASK_UNDO_DEPTH and drops the oldest snapshots first", () => {
    const labels = Array.from({ length: MAX_MASK_UNDO_DEPTH + 5 }, (_, i) => `snap-${i}`);
    const history = historyFrom(labels);
    expect(maskUndoCount(history)).toBe(MAX_MASK_UNDO_DEPTH);
    expect(history.undo[0]).toBe(snapshot(`snap-5`));
    expect(history.undo[history.undo.length - 1]).toBe(snapshot(`snap-${MAX_MASK_UNDO_DEPTH + 4}`));
  });

  it("keeps an at-cap stack stable when the oldest entry is re-pushed", () => {
    const labels = Array.from({ length: MAX_MASK_UNDO_DEPTH }, (_, i) => `snap-${i}`);
    const history = pushMaskSnapshot(historyFrom(labels), snapshot("newest"));
    expect(maskUndoCount(history)).toBe(MAX_MASK_UNDO_DEPTH);
    expect(history.undo[history.undo.length - 1]).toBe(snapshot("newest"));
  });
});

describe("undoMaskSnapshot", () => {
  it("restores snapshots in LIFO order across interleaved stroke/fill/clear operations", () => {
    const history = historyFrom(["before-stroke", "before-fill", "before-clear", "before-paste"]);

    const undo4 = undoMaskSnapshot(history);
    expect(undo4.snapshot).toBe(snapshot("before-paste"));

    const undo3 = undoMaskSnapshot(undo4.history);
    expect(undo3.snapshot).toBe(snapshot("before-clear"));

    const undo2 = undoMaskSnapshot(undo3.history);
    expect(undo2.snapshot).toBe(snapshot("before-fill"));

    const undo1 = undoMaskSnapshot(undo2.history);
    expect(undo1.snapshot).toBe(snapshot("before-stroke"));
  });

  it("undoes to empty, then further undos are null no-ops", () => {
    let history = historyFrom(["before-stroke", "before-clear"]);
    history = undoMaskSnapshot(history).history;
    history = undoMaskSnapshot(history).history;
    expect(maskUndoCount(history)).toBe(0);
    expect(canUndoMask(history)).toBe(false);

    const result = undoMaskSnapshot(history);
    expect(result.snapshot).toBeNull();
    expect(maskUndoCount(result.history)).toBe(0);
  });

  it("component mode (no current snapshot) discards the popped entry and keeps redo empty", () => {
    const history = pushMaskSnapshot(historyFrom(["a"]), snapshot("b"));
    const { history: after, snapshot: popped } = undoMaskSnapshot(history);
    expect(popped).toBe(snapshot("b"));
    expect(maskUndoCount(after)).toBe(1);
    expect(after.redo).toEqual([]);
  });

  it("returns null for an empty stack without touching history", () => {
    const history = emptyMaskUndoHistory();
    expect(undoMaskSnapshot(history)).toEqual({ history, snapshot: null });
  });
});

describe("redoMaskSnapshot", () => {
  it("round-trips undo→redo back to the same canvas state", () => {
    // Canvas is at state C; one mutation happened before it, captured as B.
    const history = pushMaskSnapshot(historyFrom([]), snapshot("B"));
    // Undo restores B and stashes the current state C for redo.
    const undone = undoMaskSnapshot(history, snapshot("C"));
    expect(undone.snapshot).toBe(snapshot("B"));
    // Redo restores C and stashes B so it can be undone again.
    const redone = redoMaskSnapshot(undone.history, snapshot("B"));
    expect(redone.snapshot).toBe(snapshot("C"));
    expect(maskUndoCount(redone.history)).toBe(1);
    // Undoing the redo returns to B again.
    expect(undoMaskSnapshot(redone.history, snapshot("C")).snapshot).toBe(snapshot("B"));
  });

  it("serves multiple redo targets newest-first", () => {
    let history = pushMaskSnapshot(emptyMaskUndoHistory(), snapshot("B1"));
    history = pushMaskSnapshot(history, snapshot("B2"));

    const undo2 = undoMaskSnapshot(history, snapshot("C2"));
    const undo1 = undoMaskSnapshot(undo2.history, snapshot("C1"));
    expect(maskUndoCount(undo1.history)).toBe(0);

    const redo1 = redoMaskSnapshot(undo1.history, snapshot("B1"));
    expect(redo1.snapshot).toBe(snapshot("C1"));
    const redo2 = redoMaskSnapshot(redo1.history, snapshot("B2"));
    expect(redo2.snapshot).toBe(snapshot("C2"));
  });

  it("is a null no-op when the redo branch is empty", () => {
    const history = historyFrom(["a"]);
    const result = redoMaskSnapshot(history, snapshot("current"));
    expect(result.snapshot).toBeNull();
    expect(result.history).toBe(history);
  });

  it("a new push invalidates the redo branch", () => {
    const history = pushMaskSnapshot(emptyMaskUndoHistory(), snapshot("B"));
    const undone = undoMaskSnapshot(history, snapshot("C"));
    const pushed = pushMaskSnapshot(undone.history, snapshot("B2"));
    expect(pushed.redo).toEqual([]);
    expect(redoMaskSnapshot(pushed, snapshot("current")).snapshot).toBeNull();
  });
});

describe("resetMaskUndoHistory", () => {
  it("drops all undo and redo history", () => {
    const reset = resetMaskUndoHistory();
    expect(canUndoMask(reset)).toBe(false);
    expect(reset.undo).toEqual([]);
    expect(reset.redo).toEqual([]);
    expect(undoMaskSnapshot(reset).snapshot).toBeNull();
  });
});
