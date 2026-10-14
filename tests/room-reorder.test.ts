/**
 * Contract pinning for the room-reorder behavior — see issue #1327.
 *
 * Two contracts:
 *
 *   1. The reorder math itself (project-detail-view.tsx →
 *      handleDragEnd → reorderRoomsById): the historical algorithm
 *      preserved as a pure helper so a future @dnd-kit/react migration
 *      cannot regress reorder semantics without a vitest failure here.
 *
 *   2. The structural pieces that make the drag handle keyboard-
 *      accessible: the handle renders as a <button>, the dnd-kit
 *      KeyboardSensor is configured with sortableKeyboardCoordinates,
 *      and the handle carries an aria-label. Pinned via source-text
 *      assertions because vitest runs in environment: "node" with no
 *      jsdom / @testing-library — running the real component requires
 *      a browser harness (tests/e2e/specs/editor-layout.spec.ts), and
 *      this contract is the unit-level guard against an upstream
 *      dnd-kit package change silently dropping keyboard support.
 */

import { describe, it, expect } from "vitest";
import { reorderRoomsById, type Identifiable } from "@/lib/room-reorder";
import fs from "node:fs";
import path from "node:path";

interface Room extends Identifiable {
  name: string;
}

const ROOMS: Room[] = [
  { id: "r1", name: "Living" },
  { id: "r2", name: "Kitchen" },
  { id: "r3", name: "Bedroom" },
  { id: "r4", name: "Office" },
];

describe("reorderRoomsById (#1327)", () => {
  it("moves the active item to the over item's position (forward)", () => {
    const result = reorderRoomsById(ROOMS, "r1", "r3");
    expect(result.map((r) => r.id)).toEqual(["r2", "r3", "r1", "r4"]);
  });

  it("moves the active item to the over item's position (backward)", () => {
    const result = reorderRoomsById(ROOMS, "r4", "r1");
    expect(result.map((r) => r.id)).toEqual(["r4", "r1", "r2", "r3"]);
  });

  it("is a no-op (returns same identity) when activeId === overId", () => {
    const result = reorderRoomsById(ROOMS, "r2", "r2");
    expect(result).toBe(ROOMS);
    expect(result.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("is a no-op (returns same identity) when activeId is missing", () => {
    const result = reorderRoomsById(ROOMS, "missing", "r2");
    expect(result).toBe(ROOMS);
  });

  it("is a no-op (returns same identity) when overId is missing", () => {
    const result = reorderRoomsById(ROOMS, "r2", "missing");
    expect(result).toBe(ROOMS);
  });

  it("returns a new array on real moves (does not mutate the input)", () => {
    const snapshot = ROOMS.map((r) => r.id);
    const result = reorderRoomsById(ROOMS, "r1", "r3");
    expect(result).not.toBe(ROOMS);
    expect(ROOMS.map((r) => r.id)).toEqual(snapshot);
    expect(result.map((r) => r.id)).toEqual(["r2", "r3", "r1", "r4"]);
  });

  it("handles a single-room list as a no-op", () => {
    const single: Room[] = [{ id: "only", name: "Solitary" }];
    expect(reorderRoomsById(single, "only", "only")).toBe(single);
  });

  it("does not duplicate or lose items across moves", () => {
    // Move each room through every other position and confirm we never
    // gain or lose entries, only re-permute them.
    const ids = ROOMS.map((r) => r.id);
    for (const active of ids) {
      for (const over of ids) {
        const result = reorderRoomsById(ROOMS, active, over);
        expect(result.map((r) => r.id).sort()).toEqual([...ids].sort());
      }
    }
  });
});

/**
 * Pinned structural contracts for the project-detail-view SortableRoom
 * and the dnd-kit sensor config — guarantees the keyboard-accessible
 * drag handle survives the future @dnd-kit/react migration (issue #1327).
 */
describe("room-reorder keyboard-accessibility (#1327)", () => {
  const viewPath = path.join(
    process.cwd(),
    "src/app/(dashboard)/projects/[id]/project-detail-view.tsx",
  );
  const source = fs.readFileSync(viewPath, "utf8");

  it("configures a dnd-kit KeyboardSensor with sortableKeyboardCoordinates", () => {
    expect(source).toMatch(/KeyboardSensor/);
    expect(source).toMatch(/sortableKeyboardCoordinates/);
  });

  it("renders the drag handle as a focusable <button>", () => {
    // The handle is rendered inside SortableRoom (line ~184) with
    // {...attributes} {...listeners}. @dnd-kit/core's useSortable
    // populates `attributes` with `role: \"button\"` + `tabIndex: 0` so
    // the handle is keyboard-focusable. Spread on a <button> means
    // the handle is reachable via Tab and operable via Space / Enter
    // through the KeyboardSensor.
    expect(source).toMatch(/<button[^>]+aria-label=\"Drag to reorder room\"/);
    expect(source).toMatch(/\{\.\.\.attributes\}/);
    expect(source).toMatch(/\{\.\.\.listeners\}/);
  });

  it("consumes the pure helper for reorder math (no inline splice)", () => {
    // Once #1327 lands, the component should use reorderRoomsById
    // instead of hand-coding splice — the contract is "the arrayMove
    // math lives in one place, and it's tested".
    expect(source).toMatch(/from \"@\/lib\/room-reorder\"/);
    expect(source).toMatch(/reorderRoomsById\(/);
  });
});
