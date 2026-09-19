"use client";

import type { KeyboardEvent } from "react";

/**
 * The focused editor's control-panel tab strip (issue #252 D5).
 *
 * Purely presentational — the editor owns all staging state, so switching
 * tabs never clears selections, the mask grid, or prompts (AC-L5). Tabs
 * follow the ARIA tabs pattern (role=tablist/tab, aria-selected, roving
 * tabindex with ArrowLeft/ArrowRight); panels are wired to the tabs via
 * aria-controls/aria-labelledby using the ids built here.
 */

/** The editor's control-panel tabs. */
export type EditorTabId = "entire" | "manual" | "detect";

export interface EditorTab {
  id: EditorTabId;
  /** Visible label (kept stable — e2e specs select tabs by this name). */
  label: string;
  /**
   * Un-run-work badge: a count renders as a small pill, `true` as a dot
   * (for work a count can't express, e.g. painted-but-unapplied mask).
   */
  badge?: number | true;
}

interface EditorTabBarProps {
  tabs: EditorTab[];
  activeTab: EditorTabId;
  onSelectTab: (tab: EditorTabId) => void;
  /** useId-derived namespace for tab/tabpanel id pairing. */
  idBase: string;
}

export default function EditorTabBar({
  tabs,
  activeTab,
  onSelectTab,
  idBase,
}: EditorTabBarProps) {
  const tabId = (id: EditorTabId) => `${idBase}-tab-${id}`;
  const panelId = (id: EditorTabId) => `${idBase}-panel-${id}`;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === activeTab);
    if (index === -1) return;
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    onSelectTab(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Staging editor tools"
      // Focus lives on the tab buttons (roving tabindex); keydown still
      // reaches this handler because it bubbles from the focused button.
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="flex items-center gap-1 border-b border-stone-200"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-selected={active}
            aria-controls={panelId(tab.id)}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelectTab(tab.id)}
            className={`relative -mb-px flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-stone-300 bg-white text-stone-900"
                : "border-transparent text-stone-500 hover:bg-stone-100 hover:text-stone-700"
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && (
              <span
                aria-hidden="true"
                className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ${
                  typeof tab.badge === "number"
                    ? "bg-stone-800 text-white"
                    : "h-2 w-2 min-w-0 bg-stone-800 p-0"
                }`}
              >
                {typeof tab.badge === "number" ? tab.badge : null}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** id of the tab panel paired with a tab (mirrors the bar's naming). */
export function editorTabPanelId(idBase: string, id: EditorTabId): string {
  return `${idBase}-panel-${id}`;
}

/** id of a tab button (mirrors the bar's naming). */
export function editorTabId(idBase: string, id: EditorTabId): string {
  return `${idBase}-tab-${id}`;
}
