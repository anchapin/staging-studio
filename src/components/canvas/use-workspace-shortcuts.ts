"use client";

import { useEffect } from "react";
import { resolveInspectorShortcut } from "@/lib/inspector-panel";

/** The collapsible-panel controller shape from use-collapsible-panel. */
export interface CollapsiblePanelController {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

export interface UseWorkspaceShortcutsInput {
  zenMode: boolean;
  setZenMode: React.Dispatch<React.SetStateAction<boolean>>;
  focusMode: boolean;
  setFocusMode: React.Dispatch<React.SetStateAction<boolean>>;
  /** Issue #588 workspace panels (backtick toggles all four). */
  brushPanel: CollapsiblePanelController;
  promptPanel: CollapsiblePanelController;
  variantPanel: CollapsiblePanelController;
  generatedVariationsPanel: CollapsiblePanelController;
  /** Issue #617 inspector column (Cmd/Ctrl+B). */
  inspectorPanel: CollapsiblePanelController;
}

/**
 * Workspace keyboard shortcuts (issue #691 extraction from
 * inpaint-editor.tsx): Z toggles Zen Mode (#560), F toggles Focus Canvas
 * Mode (#638, modifier-classified so Cmd/Ctrl+F stays browser Find),
 * Escape exits either, backtick toggles all workspace panels (#588), and
 * Cmd/Ctrl+B toggles the right inspector (#617). Text-entry targets are
 * exempt so typing never triggers chrome.
 */
export function useWorkspaceShortcuts({
  zenMode,
  setZenMode,
  focusMode,
  setFocusMode,
  brushPanel,
  promptPanel,
  variantPanel,
  generatedVariationsPanel,
  inspectorPanel,
}: UseWorkspaceShortcutsInput) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "z" || e.key === "Z") {
        if (!isInput) {
          e.preventDefault();
          setZenMode((prev) => !prev);
        }
      }

      // Issue #617/#638: inspector + focus-mode shortcut resolution
      // (pure, pinned by tests/inspector-panel.test.ts).
      const shortcut = resolveInspectorShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        isTextEntry: isInput,
      });
      if (shortcut === "toggle-inspector") {
        e.preventDefault();
        inspectorPanel.toggle();
      }
      if (shortcut === "toggle-focus-mode") {
        e.preventDefault();
        setFocusMode((prev) => !prev);
      }

      if (e.key === "Escape" && (zenMode || focusMode)) {
        e.preventDefault();
        setZenMode(false);
        setFocusMode(false);
      }

      // Issue #588: backtick toggles all workspace panels
      if (e.key === "`" && !isInput) {
        e.preventDefault();
        const allCollapsed =
          brushPanel.isCollapsed && promptPanel.isCollapsed && variantPanel.isCollapsed && generatedVariationsPanel.isCollapsed;
        if (allCollapsed) {
          brushPanel.setIsCollapsed(false);
          promptPanel.setIsCollapsed(false);
          variantPanel.setIsCollapsed(false);
          generatedVariationsPanel.setIsCollapsed(false);
        } else {
          brushPanel.setIsCollapsed(true);
          promptPanel.setIsCollapsed(true);
          variantPanel.setIsCollapsed(true);
          generatedVariationsPanel.setIsCollapsed(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zenMode, focusMode, brushPanel, promptPanel, variantPanel, generatedVariationsPanel, inspectorPanel, setZenMode, setFocusMode]);
}
