"use client";

import { Save, Send } from "lucide-react";
import {
  WORKBENCH_DOCK_POSITION_CLASSES,
  WORKBENCH_DOCK_SURFACE_CLASSES,
  workbenchSessionDotClasses,
  workbenchSessionStatusLabel,
  type WorkbenchSessionStatus,
} from "@/lib/workbench-layout";

export interface WorkbenchDockProps {
  /** Session status driving the pill label and dot. */
  sessionStatus: WorkbenchSessionStatus;
  /** Batch progress summary (see `workbenchDockStatusText`). */
  statusText: string;
  /** Called when "Save Draft" is clicked. */
  onSaveDraft: () => void;
  /** Called when "Send to Brush Refinement" is clicked. */
  onSendToBrushRefinement: () => void;
  /** Disables the Save Draft button (e.g. a save is in flight). */
  saveDisabled?: boolean;
  /** Disables the Send CTA (e.g. no staged variants yet). */
  sendDisabled?: boolean;
}

/**
 * Workbench bottom persistent dock (issue #620).
 *
 * Full-width session bar at the bottom of the workspace: session-status
 * pill + status text on the left, "Save Draft" and the "Send to Brush
 * Refinement" CTA on the right. Styled warm-glassmorphic
 * (`surface-container-lowest` at 90% + `backdrop-blur-md`, `rounded-xl`)
 * and `sticky bottom-4` WITHIN the workspace scroll area — it must be
 * rendered inside the workbench's scroll container, never viewport-fixed.
 */
export default function WorkbenchDock({
  sessionStatus,
  statusText,
  onSaveDraft,
  onSendToBrushRefinement,
  saveDisabled = false,
  sendDisabled = false,
}: WorkbenchDockProps) {
  return (
    <div
      data-workbench-dock=""
      aria-label="Workbench session dock"
      className={`z-30 mt-6 flex flex-wrap items-center gap-3 px-4 py-3 ${WORKBENCH_DOCK_POSITION_CLASSES} ${WORKBENCH_DOCK_SURFACE_CLASSES}`}
    >
      {/* Session status pill */}
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-container px-2.5 py-1 text-xs font-medium text-foreground">
        <span
          className={`h-1.5 w-1.5 rounded-full ${workbenchSessionDotClasses(sessionStatus)}`}
          aria-hidden="true"
        />
        {workbenchSessionStatusLabel(sessionStatus)}
      </span>

      {/* Status text */}
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground" role="status">
        {statusText}
      </p>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={saveDisabled}
          className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          Save Draft
        </button>
        <button
          type="button"
          onClick={onSendToBrushRefinement}
          disabled={sendDisabled}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Send to Brush Refinement
        </button>
      </div>
    </div>
  );
}
