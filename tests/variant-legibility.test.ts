import { describe, expect, it } from "vitest";

import {
  countVariantTouchUps,
  resolveActiveEditingSlot,
  resolveSelectionAfterDelete,
  resolveStripSelection,
  touchUpCountsBySlot,
  variantTouchUpLabel,
  type TouchUpRequestRow,
} from "@/lib/variant-legibility";

const COMPLETE_A = {
  before: "https://abc.supabase.co/storage/v1/object/public/rooms/before.jpg",
  after: "https://v3.fal.ai/output/after-a.png",
};
const COMPLETE_B = {
  before: "https://abc.supabase.co/storage/v1/object/public/rooms/before2.jpg",
  after: "https://v3.fal.ai/output/after-b.png",
};
const EMPTY = { before: null, after: null };
const AFTER_ONLY = { before: null, after: "https://v3.fal.ai/output/x.png" };

describe("resolveStripSelection", () => {
  it("highlights Original for a fresh room (null selection, nothing staged)", () => {
    expect(resolveStripSelection(null, [EMPTY, EMPTY])).toBe("original");
  });

  it("highlights Variant A when slot 0 is selected and complete", () => {
    expect(resolveStripSelection(0, [COMPLETE_A, EMPTY])).toBe(0);
  });

  it("highlights Variant B when slot 1 is selected and complete", () => {
    expect(resolveStripSelection(1, [EMPTY, COMPLETE_B])).toBe(1);
  });

  it("highlights Original when the selection points at an unstaged slot", () => {
    // Legacy/dangling state: selected index set but that slot has no
    // staged after image — the strip must not imply it is chosen.
    expect(resolveStripSelection(0, [EMPTY, COMPLETE_B])).toBe("original");
    expect(resolveStripSelection(1, [COMPLETE_A, EMPTY])).toBe("original");
  });

  it("normalizes unexpected raw values to slot 0 before the completeness check", () => {
    expect(resolveStripSelection(7, [COMPLETE_A, EMPTY])).toBe(0);
    expect(resolveStripSelection(7, [EMPTY, COMPLETE_B])).toBe("original");
  });
});

describe("resolveSelectionAfterDelete", () => {
  it("leaves the selection untouched when deleting the non-selected slot", () => {
    expect(resolveSelectionAfterDelete([COMPLETE_A, COMPLETE_B], 1, 0)).toBe(1);
    expect(resolveSelectionAfterDelete([COMPLETE_A, COMPLETE_B], 0, 1)).toBe(0);
  });

  it("preserves a null selection untouched when deleting either slot", () => {
    expect(resolveSelectionAfterDelete([COMPLETE_A, COMPLETE_B], null, 1)).toBeNull();
  });

  it("lands on the surviving variant when the selected slot is deleted", () => {
    expect(resolveSelectionAfterDelete([COMPLETE_A, COMPLETE_B], 0, 0)).toBe(1);
    expect(resolveSelectionAfterDelete([COMPLETE_A, COMPLETE_B], 1, 1)).toBe(0);
  });

  it("lands on null (Original) when the selected slot is deleted and the other is incomplete", () => {
    expect(resolveSelectionAfterDelete([COMPLETE_A, EMPTY], 0, 0)).toBeNull();
    expect(resolveSelectionAfterDelete([EMPTY, COMPLETE_B], 1, 1)).toBeNull();
  });

  it("never dangles on an after-only pair — the survivor must be complete", () => {
    // An after image without a before is not a stageable variant.
    expect(resolveSelectionAfterDelete([COMPLETE_A, AFTER_ONLY], 0, 0)).toBeNull();
  });
});

describe("countVariantTouchUps", () => {
  const rows: TouchUpRequestRow[] = [
    // Variant A: initial staging (original source) — not a touch-up.
    { variantSlot: 0, sourceSlot: null, status: "COMPLETED" },
    // Variant A touch-ups.
    { variantSlot: 0, sourceSlot: 0, status: "COMPLETED" },
    { variantSlot: 0, sourceSlot: 0, status: "COMPLETED" },
    { variantSlot: 0, sourceSlot: 0, status: "IN_PROGRESS" },
    // Failed runs don't count as applied touch-ups.
    { variantSlot: 0, sourceSlot: 0, status: "ERROR" },
    // Variant B touch-up, in queue.
    { variantSlot: 1, sourceSlot: 1, status: "IN_QUEUE" },
    // Variant B initial staging — not a touch-up.
    { variantSlot: 1, sourceSlot: null, status: "COMPLETED" },
  ];

  it("counts only variant-source, non-ERROR rows for the slot", () => {
    expect(countVariantTouchUps(rows, 0)).toBe(3);
    expect(countVariantTouchUps(rows, 1)).toBe(1);
  });

  it("returns 0 for a slot with no rows", () => {
    expect(countVariantTouchUps([], 1)).toBe(0);
  });

  it("aggregates both slots in one pass", () => {
    expect(touchUpCountsBySlot(rows)).toEqual({ 0: 3, 1: 1 });
    expect(touchUpCountsBySlot([])).toEqual({ 0: 0, 1: 0 });
  });
});

describe("resolveActiveEditingSlot", () => {
  it("follows the editor's source when a staged variant is chosen", () => {
    expect(
      resolveActiveEditingSlot({ kind: "variant", slot: 1 }, null)
    ).toBe(1);
  });

  it("returns null in original-photo mode with nothing pending", () => {
    expect(resolveActiveEditingSlot({ kind: "original" }, null)).toBeNull();
  });

  it("follows a resuming pending run that edits a variant", () => {
    expect(
      resolveActiveEditingSlot({ kind: "original" }, { kind: "variant", slot: 0 })
    ).toBe(0);
  });

  it("returns null when the pending run is an original-photo run", () => {
    expect(
      resolveActiveEditingSlot({ kind: "original" }, { kind: "original" })
    ).toBeNull();
  });
});

describe("variantTouchUpLabel", () => {
  it("omits the count suffix before any touch-up has landed", () => {
    expect(variantTouchUpLabel(0, 0)).toBe("Editing Variant A");
    expect(variantTouchUpLabel(1, 0)).toBe("Editing Variant B");
  });

  it("uses the singular for one touch-up", () => {
    expect(variantTouchUpLabel(0, 1)).toBe("Editing Variant A · 1 touch-up");
    expect(variantTouchUpLabel(1, 1)).toBe("Editing Variant B · 1 touch-up");
  });

  it("pluralizes beyond one", () => {
    expect(variantTouchUpLabel(0, 3)).toBe("Editing Variant A · 3 touch-ups");
  });
});
