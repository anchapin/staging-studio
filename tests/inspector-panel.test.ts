import { describe, expect, it } from "vitest";
import {
  INSPECTOR_PANEL_STORAGE_KEY,
  INSPECTOR_PANEL_WIDTH_PX,
  INSPECTOR_RAIL_ACTIONS,
  INSPECTOR_RAIL_LABEL,
  INSPECTOR_RAIL_WIDTH_PX,
  resolveInspectorPanelView,
  resolveInspectorRailTarget,
  resolveInspectorShortcut,
  type InspectorShortcutEvent,
} from "@/lib/inspector-panel";

/** Shorthand for the DOM-free shortcut event shape. */
function keyEvent(
  key: string,
  modifiers: Partial<InspectorShortcutEvent> = {}
): InspectorShortcutEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isTextEntry: false,
    ...modifiers,
  };
}

describe("inspector-panel constants — issue #617", () => {
  it("expanded panel is 380px wide", () => {
    expect(INSPECTOR_PANEL_WIDTH_PX).toBe(380);
  });

  it("collapsed rail is 48px wide", () => {
    expect(INSPECTOR_RAIL_WIDTH_PX).toBe(48);
  });

  it("rail label is 'Active Inpaint'", () => {
    expect(INSPECTOR_RAIL_LABEL).toBe("Active Inpaint");
  });

  it("storage key follows the #588 inpaint-editor:<panel> naming", () => {
    expect(INSPECTOR_PANEL_STORAGE_KEY).toBe("inpaint-editor:inspectorPanel");
  });
});

describe("resolveInspectorShortcut — Cmd/Ctrl+B inspector toggle", () => {
  it("Cmd+B toggles the inspector", () => {
    expect(resolveInspectorShortcut(keyEvent("b", { metaKey: true }))).toBe(
      "toggle-inspector"
    );
  });

  it("Ctrl+B toggles the inspector (Windows)", () => {
    expect(resolveInspectorShortcut(keyEvent("b", { ctrlKey: true }))).toBe(
      "toggle-inspector"
    );
  });

  it("uppercase Cmd+B still toggles (key arrives as 'B')", () => {
    expect(resolveInspectorShortcut(keyEvent("B", { metaKey: true }))).toBe(
      "toggle-inspector"
    );
  });

  it("Cmd+B toggles even from a text input (spec snippet has no input guard)", () => {
    expect(
      resolveInspectorShortcut(keyEvent("b", { metaKey: true, isTextEntry: true }))
    ).toBe("toggle-inspector");
  });

  it("plain 'b' without a modifier does nothing", () => {
    expect(resolveInspectorShortcut(keyEvent("b"))).toBeNull();
  });

  it("Alt+B does nothing (only Cmd/Ctrl qualify)", () => {
    expect(resolveInspectorShortcut(keyEvent("b", { altKey: true }))).toBeNull();
  });
});

describe("resolveInspectorShortcut — F focus-canvas toggle", () => {
  it("bare F toggles Focus Canvas Mode", () => {
    expect(resolveInspectorShortcut(keyEvent("f"))).toBe("toggle-focus-mode");
  });

  it("uppercase F toggles too", () => {
    expect(resolveInspectorShortcut(keyEvent("F"))).toBe("toggle-focus-mode");
  });

  it("F while typing in an input/textarea does nothing", () => {
    expect(
      resolveInspectorShortcut(keyEvent("f", { isTextEntry: true }))
    ).toBeNull();
  });

  it("Cmd+F is NOT focus mode (stays browser Find)", () => {
    expect(resolveInspectorShortcut(keyEvent("f", { metaKey: true }))).toBeNull();
  });

  it("Ctrl+F is NOT focus mode", () => {
    expect(resolveInspectorShortcut(keyEvent("f", { ctrlKey: true }))).toBeNull();
  });

  it("Alt+F is NOT focus mode", () => {
    expect(resolveInspectorShortcut(keyEvent("f", { altKey: true }))).toBeNull();
  });
});

describe("resolveInspectorShortcut — everything else falls through", () => {
  it("unrelated keys resolve to null", () => {
    expect(resolveInspectorShortcut(keyEvent("x"))).toBeNull();
    expect(resolveInspectorShortcut(keyEvent("Escape"))).toBeNull();
    expect(resolveInspectorShortcut(keyEvent("`"))).toBeNull();
  });

  it("Cmd+Z (undo) resolves to null — zen mode's domain, untouched", () => {
    expect(resolveInspectorShortcut(keyEvent("z", { metaKey: true }))).toBeNull();
  });
});

describe("resolveInspectorPanelView — panel/rail/hidden state machine", () => {
  it("default: expanded panel", () => {
    expect(
      resolveInspectorPanelView({
        inspectorCollapsed: false,
        focusMode: false,
        zenMode: false,
      })
    ).toBe("expanded");
  });

  it("collapsed state renders the 48px rail", () => {
    expect(
      resolveInspectorPanelView({
        inspectorCollapsed: true,
        focusMode: false,
        zenMode: false,
      })
    ).toBe("rail");
  });

  it("Focus Canvas Mode hides the column entirely — no rail (#638 owns the way back)", () => {
    expect(
      resolveInspectorPanelView({
        inspectorCollapsed: false,
        focusMode: true,
        zenMode: false,
      })
    ).toBe("hidden");
    expect(
      resolveInspectorPanelView({
        inspectorCollapsed: true,
        focusMode: true,
        zenMode: false,
      })
    ).toBe("hidden");
  });

  it("Zen Mode hides the column entirely", () => {
    expect(
      resolveInspectorPanelView({
        inspectorCollapsed: false,
        focusMode: false,
        zenMode: true,
      })
    ).toBe("hidden");
    expect(
      resolveInspectorPanelView({
        inspectorCollapsed: true,
        focusMode: false,
        zenMode: true,
      })
    ).toBe("hidden");
  });

  it("exiting Focus/Zen restores the pre-collapse state (collapse state is not clobbered)", () => {
    const collapsedWhileFocused = resolveInspectorPanelView({
      inspectorCollapsed: true,
      focusMode: true,
      zenMode: false,
    });
    expect(collapsedWhileFocused).toBe("hidden");
    expect(
      resolveInspectorPanelView({
        inspectorCollapsed: true,
        focusMode: false,
        zenMode: false,
      })
    ).toBe("rail");
  });
});

describe("INSPECTOR_RAIL_ACTIONS — collapsed rail metadata", () => {
  it("has exactly the three spec'd icon buttons in order", () => {
    expect(INSPECTOR_RAIL_ACTIONS.map((a) => a.id)).toEqual([
      "palette",
      "auto-awesome",
      "wb-sunny",
    ]);
  });

  it("carries the spec's Material Symbols names", () => {
    expect(INSPECTOR_RAIL_ACTIONS.map((a) => a.materialSymbol)).toEqual([
      "palette",
      "auto_awesome",
      "wb_sunny",
    ]);
  });

  it("every action has a non-empty accessible label", () => {
    for (const action of INSPECTOR_RAIL_ACTIONS) {
      expect(action.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("resolveInspectorRailTarget — where rail buttons land", () => {
  it("palette → Manual paint tab, Inpaint Zone mode (targeted prompt editor)", () => {
    expect(resolveInspectorRailTarget("palette")).toEqual({
      tab: "manual",
      operationMode: "inpaint-zone",
    });
  });

  it("auto_awesome → Manual paint tab (AI variations section below)", () => {
    expect(resolveInspectorRailTarget("auto-awesome")).toEqual({
      tab: "manual",
    });
  });

  it("wb_sunny → Manual paint tab, Relight mode", () => {
    expect(resolveInspectorRailTarget("wb-sunny")).toEqual({
      tab: "manual",
      operationMode: "relight",
    });
  });

  it("every target names a valid editor tab", () => {
    const validTabs = new Set(["entire", "manual", "detect"]);
    for (const action of INSPECTOR_RAIL_ACTIONS) {
      expect(validTabs.has(resolveInspectorRailTarget(action.id).tab)).toBe(
        true
      );
    }
  });

  it("every optional operation mode names a valid #629 mode", () => {
    const validModes = new Set([
      "inpaint-zone",
      "restore-original",
      "relight",
      "material-swap",
    ]);
    for (const action of INSPECTOR_RAIL_ACTIONS) {
      const { operationMode } = resolveInspectorRailTarget(action.id);
      if (operationMode !== undefined) {
        expect(validModes.has(operationMode)).toBe(true);
      }
    }
  });
});
