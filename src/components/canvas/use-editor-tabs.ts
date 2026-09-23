"use client";

import { useCallback, useId, useState } from "react";
import type { EditorTab, EditorTabId } from "./editor-tab-bar";
import { entireRoomTabVisible, type InpaintSource } from "@/lib/inpaint-source";

export interface UseEditorTabsInput {
  /** The displayed base — Entire room is only available over the original photo (AC-L4). */
  source: InpaintSource;
  /** Un-run work badges (AC-L5): a painted-but-unapplied mask. */
  hasPaintedMask: boolean;
  /** Un-run work badge: pending region selections. */
  selectionCount: number;
  /** Issue #748: arming callback when the Auto detect tab is selected. */
  onSelectDetectTab: () => void;
}

/**
 * Control-panel tab state (issue #691 extraction from inpaint-editor.tsx,
 * issue #252 D5): purely presentational, so switching never touches
 * staging state (AC-L5). The default is the Auto detect tab.
 *
 * AC-L4: tab availability is a pure function of the displayed base image —
 * Entire room only over the original photo. Derived in render (zero
 * effects): over a variant the tab disappears and the panel lands on
 * Manual; switching back brings Entire room (and its active state)
 * straight back.
 */
export function useEditorTabs({
  source,
  hasPaintedMask,
  selectionCount,
  onSelectDetectTab,
}: UseEditorTabsInput) {
  const [activeTab, setActiveTab] = useState<EditorTabId>("detect");
  const tabIdBase = useId();

  const showEntireRoomTab = entireRoomTabVisible(source);
  const effectiveTab =
    activeTab === "entire" && !showEntireRoomTab ? "manual" : activeTab;
  const editorTabs: EditorTab[] = [
    ...(showEntireRoomTab
      ? [{ id: "entire" as const, label: "Entire room" }]
      : []),
    {
      id: "manual",
      label: "Manual paint",
      // Un-run work badge (AC-L5): a painted-but-unapplied mask.
      badge: hasPaintedMask ? true : undefined,
    },
    ...[
      {
        id: "detect" as const,
        label: "Auto detect",
        // Un-run work badge: pending region selections.
        badge: selectionCount > 0 ? selectionCount : undefined,
      },
    ],
  ];

  const handleTabSelect = useCallback(
    (tab: EditorTabId) => {
      setActiveTab(tab);
      if (tab === "detect") onSelectDetectTab();
    },
    [onSelectDetectTab]
  );

  return {
    activeTab,
    setActiveTab,
    tabIdBase,
    editorTabs,
    effectiveTab,
    handleTabSelect,
  };
}
