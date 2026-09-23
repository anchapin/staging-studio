"use client";

import { Loader2, PanelRightClose } from "lucide-react";
import { batchProgressText, hasFailedStep } from "@/lib/multi-select-batch";
import type { ActiveBatch } from "./batch-staging-panel";

export interface InspectorHeaderProps {
  /** Issue #617: the collapse toggle (Cmd+B). */
  onToggleCollapse: () => void;
  isExpanded: boolean;
  /** AC-L2: batch progress pins to the panel top during a run. */
  activeBatch: ActiveBatch | null;
}

/**
 * The inspector column's fixed header (issue #691 extraction from
 * inpaint-editor.tsx): the "Active Inpaint Zone" title with the #617
 * collapse toggle, plus the AC-L2 batch-progress banner.
 */
export default function InspectorHeader({
  onToggleCollapse,
  isExpanded,
  activeBatch,
}: InspectorHeaderProps) {
  return (
    <>
      <div className="flex shrink-0 items-center justify-between rounded-md border border-atelier-taupe/30 bg-white px-3 py-2">
        <h3 className="font-jakarta text-sm font-semibold text-atelier-primary">
          Active Inpaint Zone
        </h3>
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Collapse inspector (Cmd+B)"
          aria-label="Collapse inspector (Cmd+B)"
          aria-expanded={isExpanded}
          aria-controls="inspector-panel-content"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-atelier-taupe/40 bg-white text-atelier-taupe shadow-sm transition-colors hover:bg-atelier-canvas hover:text-atelier-primary"
        >
          <PanelRightClose className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {/* AC-L2: batch progress pins to the panel top during a run, so
          it stays visible beside the canvas on every tab. The full
          progress + retry affordance stays in the batch panel. */}
      {activeBatch && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
        >
          {!hasFailedStep(activeBatch.progress) && (
            <Loader2
              className="h-3.5 w-3.5 animate-spin"
              aria-hidden="true"
            />
          )}
          {batchProgressText(activeBatch.progress) ??
            "Batch staging in progress…"}
        </div>
      )}
    </>
  );
}
