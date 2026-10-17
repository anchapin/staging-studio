import { describe, expect, it } from "vitest";

import {
  createInitialEditRoomState,
  editRoomReducer,
  initialEditRoomState,
  type EditRoomAction,
} from "@/components/edit-room/edit-room-reducer";

// Issue #1337 acceptance criterion: a vitest test exercises the
// EditRoomStudio reducer-equivalent (state transitions on
// scope/viewing/clear) WITHOUT mounting React.
//
// The shell owns the state in §"State machine" of #1337. This test pins
// the pure transitions (reducer) the hook delegates to, so future slices
// (#1338..#1346) can rely on the same transitions without re-deriving them.
describe("editRoomReducer", () => {
  const started = { ...initialEditRoomState };

  it("starts with the documented initial state", () => {
    expect(started).toMatchObject({
      scope: "whole-room",
      viewing: "original",
      lookbookSlot: "A",
      concept: null,
      selected: [],
      maskVersion: 0,
      hasMask: false,
      brushSize: 48,
      brushMode: "paint",
      compare: false,
      running: null,
      toast: null,
      
    });
  });

  it("SET_SCOPE updates scope; turns compare off (design's scope-change contract)", () => {
    const after = editRoomReducer(started, {
      type: "SET_SCOPE",
      scope: "objects",
    } satisfies EditRoomAction);
    expect(after.scope).toBe("objects");
    expect(after.compare).toBe(false);
  });

  it("SET_VIEWING updates viewing; clears the mask + selection (per the design's switch-version contract)", () => {
    const after = editRoomReducer(started, {
      type: "SET_VIEWING",
      viewing: "A",
    } satisfies EditRoomAction);
    expect(after.viewing).toBe("A");
    expect(after.compare).toBe(false);
    expect(after.selected).toEqual([]);
    expect(after.maskVersion).toBe(1); // CLEAR_MASK bumps maskVersion
    expect(after.hasMask).toBe(false);
  });

  it("CLEAR_MASK bumps maskVersion and forces hasMask=false", () => {
    const seeded = {
      ...started,
      hasMask: true,
      maskVersion: 3,
    };
    const after = editRoomReducer(seeded, { type: "CLEAR_MASK" });
    expect(after.hasMask).toBe(false);
    expect(after.maskVersion).toBe(4);
  });

  it("MARK_MASK_PAINTED sets hasMask=true (first-stroke dispatch from MaskLayer)", () => {
    const after = editRoomReducer(started, { type: "MARK_MASK_PAINTED" });
    expect(after.hasMask).toBe(true);
    // maskVersion is NOT bumped here — paint adds to the buffer, doesn't reset it
    expect(after.maskVersion).toBe(0);
  });

  it("TOGGLE_OBJECT adds and removes objects idempotently", () => {
    const added = editRoomReducer(started, {
      type: "TOGGLE_OBJECT",
      objectId: "sofa",
    });
    expect(added.selected).toEqual(["sofa"]);
    const removed = editRoomReducer(added, {
      type: "TOGGLE_OBJECT",
      objectId: "sofa",
    });
    expect(removed.selected).toEqual([]);
  });

  it("SET_COMPARE toggles the boolean compare flag", () => {
    expect(editRoomReducer(started, { type: "SET_COMPARE", compare: true }).compare).toBe(true);
    expect(editRoomReducer(started, { type: "SET_COMPARE", compare: false }).compare).toBe(false);
  });

  it("TOGGLE_COMPARE flips the compare flag", () => {
    expect(editRoomReducer(started, { type: "TOGGLE_COMPARE" }).compare).toBe(true);
    const on = editRoomReducer(started, { type: "TOGGLE_COMPARE" });
    expect(editRoomReducer(on, { type: "TOGGLE_COMPARE" }).compare).toBe(false);
  });

  it("SET_LOOKBOOK_SLOT pins the variant for the lookbook", () => {
    expect(
      editRoomReducer(started, { type: "SET_LOOKBOOK_SLOT", slot: "B" }).lookbookSlot
    ).toBe("B");
  });

  it("SET_BRUSH_SIZE and SET_BRUSH_MODE update the brush controls", () => {
    const sized = editRoomReducer(started, { type: "SET_BRUSH_SIZE", size: 72 });
    expect(sized.brushSize).toBe(72);
    const erased = editRoomReducer(sized, { type: "SET_BRUSH_MODE", mode: "erase" });
    expect(erased.brushMode).toBe("erase");
  });

  it("SET_CONCEPT clears the prior selection (design's reset-on-concept-change contract)", () => {
    const withSelection = {
      ...started,
      concept: "Sofa" as string | null,
      selected: ["sofa"],
    };
    const after = editRoomReducer(withSelection, {
      type: "SET_CONCEPT",
      concept: "Chair",
    });
    expect(after.concept).toBe("Chair");
    expect(after.selected).toEqual([]);
  });

  it("CLEAR_SELECTION empties selected without touching maskVersion", () => {
    const seeded = {
      ...started,
      selected: ["a", "b"],
      maskVersion: 5,
    };
    const after = editRoomReducer(seeded, { type: "CLEAR_SELECTION" });
    expect(after.selected).toEqual([]);
    expect(after.maskVersion).toBe(5); // NOT bumped — selection clear is independent of mask clear
  });

  it("RUN_START stores a running progress (number); RUN_DONE clears it", () => {
    const running = editRoomReducer(started, { type: "RUN_START" });
    expect(running.running).toBe(0);
    const done = editRoomReducer(running, { type: "RUN_DONE" });
    expect(done.running).toBeNull();
  });

  it("RUN_PROGRESS updates the progress percentage without changing other state", () => {
    const seeded = editRoomReducer(started, { type: "RUN_START" });
    const halfway = editRoomReducer(seeded, { type: "RUN_PROGRESS", progress: 42 });
    expect(halfway.running).toBe(42);
    // Other fields untouched
    expect(halfway.scope).toBe(started.scope);
    expect(halfway.viewing).toBe(started.viewing);
  });

  it("SET_MASK_DATA_URL stores the data URL verbatim without touching hasMask", () => {
    // Issue #1344 (real `useInpaintRuns` wire) — MaskLayer emits
    // `toDataURL("image/png")` after every stroke; the shell
    // mirrors it locally so the canvas subtree can react. The
    // submit path reads the most recent value at submit time.
    const next = editRoomReducer(started, {
      type: "SET_MASK_DATA_URL",
      value: "data:image/png;base64,iVBORw0KGgo",
    });
    expect(next.maskDataUrl).toBe("data:image/png;base64,iVBORw0KGgo");
    // Sanity: hasMask unchanged — the snapshot is independent of
    // the painted-state flag (erase-mode strokes emit non-null
    // data URLs even when hasMask flips to false).
    expect(next.hasMask).toBe(started.hasMask);
  });

  it("CLEAR_MASK bumps maskVersion AND nulls maskDataUrl (no stale snapshot to submit)", () => {
    // Issue #1344 — CLEAR_MASK means the buffer just became
    // empty; dropping the data URL alongside hasMask=false means
    // a Run click after clear cannot submit a stale snapshot.
    const seeded = editRoomReducer(started, {
      type: "SET_MASK_DATA_URL",
      value: "data:image/png;base64,stale",
    });
    const cleared = editRoomReducer(seeded, { type: "CLEAR_MASK" });
    expect(cleared.hasMask).toBe(false);
    expect(cleared.maskDataUrl).toBeNull();
    // maskVersion bumped (existing CLEAR_MASK behavior).
    expect(cleared.maskVersion).toBe(started.maskVersion + 1);
  });

  it("SET_VIEWING resets maskDataUrl (switching versions starts blank)", () => {
    // Issue #1344 — when the user switches to a different variant
    // (Original / A / B), the canvas clears and the prior
    // data URL would be stale.
    const seeded = editRoomReducer(started, {
      type: "SET_MASK_DATA_URL",
      value: "data:image/png;base64,stale",
    });
    const switched = editRoomReducer(seeded, {
      type: "SET_VIEWING",
      viewing: "A",
    });
    expect(switched.maskDataUrl).toBeNull();
    expect(switched.viewing).toBe("A");
  });

  it("SHOW_TOAST/DISMISS_TOAST round-trip the toast message", () => {
    const shown = editRoomReducer(started, {
      type: "SHOW_TOAST",
      message: "Staged result saved as Variant A",
    });
    expect(shown.toast).toBe("Staged result saved as Variant A");
    const dismissed = editRoomReducer(shown, { type: "DISMISS_TOAST" });
    expect(dismissed.toast).toBeNull();
  });

  // Issue #1359 — `createInitialEditRoomState` is the lazy-initializer
  // entry point used by `<EditRoomStudio>` to seed the reducer. Pre-#1365
  // it accepted a `{ directions }` override sourced from the parent route's
  // `Room.rawDirectives`. #1365 lifted the source of truth for the
  // textarea value out of the reducer — `createInitialEditRoomState` no
  // longer accepts a `directions` override (TypeScript will reject any
  // caller that passes one). The remaining contract is that the no-arg
  // call returns the canonical `initialEditRoomState` exactly, so any
  // existing lazy initializer in `<EditRoomStudio>` still produces a
  // well-typed state value.
  it("createInitialEditRoomState() returns the canonical default when called with no overrides", () => {
    expect(createInitialEditRoomState()).toEqual(initialEditRoomState);
  });
});
