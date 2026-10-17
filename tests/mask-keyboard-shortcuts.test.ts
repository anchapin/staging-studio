import { describe, expect, it } from "vitest";
import {
  isMaskUndoShortcut,
  isMaskRedoShortcut,
} from "../src/components/canvas/use-mask-keyboard-painting";

// Issue #1223: redo must take precedence over undo, and Ctrl+Y must count as
// redo even though z is untouched. These helpers are pure so the shortcut
// wiring can be pinned without a DOM.

const base = { metaKey: false, ctrlKey: false, key: "z", shiftKey: false };

describe("mask keyboard shortcuts (issue #1223)", () => {
  it("classifies plain Cmd/Ctrl+Z as undo", () => {
    expect(isMaskUndoShortcut({ ...base, metaKey: true })).toBe(true);
    expect(isMaskUndoShortcut({ ...base, ctrlKey: true })).toBe(true);
    expect(isMaskRedoShortcut({ ...base, metaKey: true })).toBe(false);
  });

  it("classifies Cmd/Ctrl+Shift+Z as redo, never undo", () => {
    expect(isMaskRedoShortcut({ ...base, metaKey: true, shiftKey: true })).toBe(true);
    expect(isMaskRedoShortcut({ ...base, ctrlKey: true, shiftKey: true })).toBe(true);
    expect(isMaskUndoShortcut({ ...base, metaKey: true, shiftKey: true })).toBe(false);
    expect(isMaskUndoShortcut({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it("classifies Ctrl+Y as redo (Cmd+Y stays unbound)", () => {
    expect(isMaskRedoShortcut({ ...base, ctrlKey: true, key: "y" })).toBe(true);
    expect(isMaskRedoShortcut({ ...base, ctrlKey: true, key: "Y" })).toBe(true);
    expect(isMaskRedoShortcut({ ...base, metaKey: true, key: "y" })).toBe(false);
    expect(isMaskUndoShortcut({ ...base, ctrlKey: true, key: "y" })).toBe(false);
  });

  it("rejects unrelated keys and bare modifiers", () => {
    for (const ev of [
      { ...base, key: "u" },
      { ...base, metaKey: true, key: "s" },
      { ...base, shiftKey: true, key: "Z" },
    ]) {
      expect(isMaskUndoShortcut(ev)).toBe(false);
      expect(isMaskRedoShortcut(ev)).toBe(false);
    }
  });

  it("treats Ctrl+Cmd+Shift+Z as redo intent, never undo", () => {
    expect(isMaskRedoShortcut({ ...base, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(true);
    expect(isMaskUndoShortcut({ ...base, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(false);
  });

  it("accepts uppercase Z variants for both shortcuts", () => {
    expect(isMaskUndoShortcut({ ...base, metaKey: true, key: "Z" })).toBe(true);
    expect(isMaskRedoShortcut({ ...base, ctrlKey: true, shiftKey: true, key: "Z" })).toBe(true);
  });
});
