"use client";

import { Maximize2, Minimize2, ImageIcon } from "lucide-react";

export interface SourceImageHeaderProps {
  zenMode: boolean;
  focusMode: boolean;
  showBefore: boolean;
  onToggleFocusMode: () => void;
  onToggleZenMode: () => void;
  onToggleShowBefore: () => void;
}

/**
 * Issue #547/#546: sticky "Source Image" header per the Atelier Canvas
 * spec, with the Focus Canvas (#638) and Zen Mode (#560) buttons. Hidden
 * in either mode via the zen-mode-hidden class (extracted from
 * inpaint-editor.tsx by #691).
 */
export default function SourceImageHeader({
  zenMode,
  focusMode,
  showBefore,
  onToggleFocusMode,
  onToggleZenMode,
  onToggleShowBefore,
}: SourceImageHeaderProps) {
  return (
    <div
      className={`sticky top-0 z-20 flex items-center justify-between bg-atelier-canvas ${
        zenMode || focusMode ? "zen-mode-hidden" : ""
      }`}
    >
      <h4 className="mb-2 font-jakarta text-sm font-medium text-atelier-primary">Source Image</h4>
      <div className="flex items-center gap-2">
        {/* Issue #638: Focus Canvas button */}
        <button
          type="button"
          onClick={onToggleFocusMode}
          title={focusMode ? "Exit Focus Canvas (F)" : "Enter Focus Canvas (F)"}
          aria-label={focusMode ? "Exit Focus Canvas" : "Enter Focus Canvas"}
          className="flex items-center gap-1.5 rounded-md border border-atelier-taupe/40 bg-white px-2.5 py-1.5 text-xs text-atelier-taupe shadow-sm transition-colors hover:bg-atelier-canvas hover:text-atelier-primary"
        >
          {focusMode ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {focusMode ? "Exit Focus" : "Focus Canvas"}
        </button>
        {/* Issue #560: Zen Mode button */}
        <button
          type="button"
          onClick={onToggleZenMode}
          title={zenMode ? "Exit Zen Mode (Z)" : "Enter Zen Mode (Z)"}
          aria-label={zenMode ? "Exit Zen Mode" : "Enter Zen Mode"}
          className="flex items-center gap-1.5 rounded-md border border-atelier-taupe/40 bg-white px-2.5 py-1.5 text-xs text-atelier-taupe shadow-sm transition-colors hover:bg-atelier-canvas hover:text-atelier-primary"
        >
          {zenMode ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {zenMode ? "Exit Zen" : "Zen Mode"}
        </button>
        {/* Issue #781: Before/After comparison toggle */}
        <button
          type="button"
          onClick={onToggleShowBefore}
          title={showBefore ? "Showing original (before)" : "Showing staged (after)"}
          aria-label={showBefore ? "Show staged result (after)" : "Show original image (before)"}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs shadow-sm transition-colors ${
            showBefore
              ? "border-atelier-taupe/40 bg-white text-atelier-taupe hover:bg-atelier-canvas hover:text-atelier-primary"
              : "border-atelier-green/50 bg-atelier-green/10 text-atelier-green hover:bg-atelier-green/20"
          }`}
        >
          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {showBefore ? "Before" : "After"}
        </button>
      </div>
    </div>
  );
}
