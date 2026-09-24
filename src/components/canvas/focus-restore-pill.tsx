"use client";

import { Expand, Home } from "lucide-react";

export interface FocusRestorePillProps {
  /** Issue #638: Project name for the Focus Canvas Mode breadcrumb. */
  projectName?: string;
  /** Issue #638: Room name for the Focus Canvas Mode breadcrumb. */
  roomName?: string;
  onRestore: () => void;
}

/**
 * Issue #638: Floating restore pill — shown at top-center when Focus
 * Canvas Mode is active (extracted from inpaint-editor.tsx by #691).
 */
export default function FocusRestorePill({
  projectName,
  roomName,
  onRestore,
}: FocusRestorePillProps) {
  return (
    <div
      className="fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-outline-variant/50 bg-surface-container-lowest/95 px-4 py-2 shadow-warm-lg transition-all duration-200 max-w-md"
      style={{ opacity: 0, animation: "focusPillShow 200ms ease-out forwards" }}
    >
      <div className="flex items-center gap-2">
        <Home className="h-4 w-4 text-secondary" aria-hidden="true" />
        <span className="font-jakarta text-sm text-secondary">
          {projectName && roomName
            ? `${projectName} > ${roomName}`
            : projectName || roomName || "Project"}
        </span>
      </div>
      <div className="h-4 w-px bg-outline-variant/50" aria-hidden="true" />
      <button
        type="button"
        onClick={onRestore}
        title="Restore Layout"
        aria-label="Restore Layout"
        className="flex items-center gap-1.5 font-jakarta text-sm text-secondary hover:text-primary label-sm"
      >
        Restore Layout
        <Expand className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
