"use client";

import { ArrowLeft } from "lucide-react";

export interface ExitToProjectButtonProps {
  onClick: () => void;
  className?: string;
}

/**
 * Issue #1188: "Back to project" control for Zen Mode, where the page
 * header (and its "All rooms" link) is hidden.
 */
export default function ExitToProjectButton({ onClick, className = "" }: ExitToProjectButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Back to project overview"
      aria-label="Back to project"
      data-testid="exit-to-project"
      className={`inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white/95 px-3 py-1.5 font-jakarta text-xs font-medium text-stone-700 shadow-md backdrop-blur-sm transition-colors hover:bg-stone-100 hover:text-stone-900 ${className}`}
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      Back to project
    </button>
  );
}
