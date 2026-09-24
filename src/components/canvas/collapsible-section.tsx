"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// -------------------------------------------------------------------------
// Issue #588: Collapsible workspace panels — localStorage-persisted state
// (extracted from inpaint-editor.tsx by issue #691).
// -------------------------------------------------------------------------

/** Persists collapsed state in localStorage so it survives page reloads. */
export function useCollapsiblePanel(storageKey: string, defaultCollapsed = false) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? JSON.parse(stored) : defaultCollapsed;
    } catch {
      return defaultCollapsed;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(isCollapsed));
    } catch {
      // localStorage may be unavailable (private browsing, quota exceeded)
    }
  }, [storageKey, isCollapsed]);

  const toggle = useCallback(() => setIsCollapsed((prev: boolean) => !prev), []);

  return { isCollapsed, setIsCollapsed, toggle };
}

/** Panel header label for issue #588 collapsible panels. */
export const PANEL_LABELS = {
  brushPanel: "Brush Tools",
  promptPanel: "Prompts & Suggestions",
  variantPanel: "Layers & Variants",
  generatedVariationsPanel: "Generated Variations",
} as const;

export interface CollapsibleSectionProps {
  id: keyof typeof PANEL_LABELS;
  title?: string;
  isCollapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Additional className for the outer wrapper */
  className?: string;
}

/**
 * Collapsible section wrapper (issue #588).
 * Renders a clickable header with chevron indicator and collapsible content.
 */
export default function CollapsibleSection({
  id,
  title,
  isCollapsed,
  onToggle,
  children,
  className = "",
}: CollapsibleSectionProps) {
  const label = title ?? PANEL_LABELS[id];
  return (
    <div className={`rounded-md border border-atelier-taupe/30 ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-atelier-primary hover:bg-atelier-canvas transition-colors"
        aria-expanded={!isCollapsed}
        aria-controls={`collapsible-panel-${id}`}
        title={`${isCollapsed ? "Show" : "Hide"} ${label}`}
      >
        <span>{label}</span>
        {isCollapsed ? (
          <ChevronDown className="h-4 w-4 text-atelier-taupe" aria-hidden="true" />
        ) : (
          <ChevronUp className="h-4 w-4 text-atelier-taupe" aria-hidden="true" />
        )}
      </button>
      {!isCollapsed && (
        <div id={`collapsible-panel-${id}`} className="px-3 pb-3 pt-1">
          {children}
        </div>
      )}
    </div>
  );
}
