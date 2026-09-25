"use client";

import { Loader2 } from "lucide-react";
import BatchStagingPanel, { type ActiveBatch } from "./batch-staging-panel";
import { editorTabId, editorTabPanelId } from "./editor-tab-bar";
import { buildConceptEmptyMessage, CONCEPT_CHIPS } from "@/lib/concept-chips";
import { MAX_BATCH_OBJECTS, type BatchSelection } from "@/lib/multi-select-batch";
import { type DeclutterIntensity } from "@/lib/holistic-prompt";
import type { SegmentCacheEntry } from "@/lib/segment-cache";
import type {
  SegmentPrewarmFailedReason,
  SegmentPrewarmStatus,
} from "./use-segment-prewarm";

export interface DetectTabPanelProps {
  tabIdBase: string;
  hidden: boolean;
  imageUrl: string;
  isProcessing: boolean;
  /** Concept-detection surface (issue #748 explicit refresh). */
  detectionArmed: boolean;
  onArmDetection: () => void;
  requestedConcept: string;
  conceptLoading: boolean;
  conceptStatus: SegmentPrewarmStatus;
  conceptFailedReason?: SegmentPrewarmFailedReason;
  displayedResult: SegmentCacheEntry | null;
  /** Concept chips + custom free-text concept. */
  onConceptChange: (concept: string) => void;
  onConceptSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  conceptInputId: string;
  conceptInput: string;
  onConceptInputChange: (value: string) => void;
  conceptInputError: string | null;
  onConceptInputErrorChange: (error: string | null) => void;
  /** Bulk affordances (issue #249/#474). */
  onSelectAllDetected: () => void;
  onClearSelection: () => void;
  detectedCount: number;
  selectionCount: number;
  selectAllNotice: string | null;
  /** Escape hatch to the Manual paint tab when detection fails. */
  onSwitchToManualTab: () => void;
  /** Issue #203 batch panel. */
  batchSelections: BatchSelection[];
  instanceLabels: Array<string | null> | null;
  aesthetic: string;
  activeBatch: ActiveBatch | null;
  onBatchRun: (input: {
    mode: "thematic" | "per-object";
    thematicPrompt: string;
    perObjectPrompts: string[];
    declutterMode: boolean;
    declutterIntensity: DeclutterIntensity;
  }) => void;
  onBatchRetry: () => void;
  onRemoveLastSelection: () => void;
  onRemoveSelection: (id: string) => void;
}

/**
 * "Auto detect" tab panel (extracted from inpaint-editor.tsx by #691):
 * the #748 lazy-refresh notice, #228 concept chips + validated free
 * text, #249/#474 bulk affordances, and the #203 batch staging panel.
 */
export default function DetectTabPanel({
  tabIdBase,
  hidden,
  imageUrl,
  isProcessing,
  detectionArmed,
  onArmDetection,
  requestedConcept,
  conceptLoading,
  conceptStatus,
  conceptFailedReason,
  displayedResult,
  onConceptChange,
  onConceptSubmit,
  conceptInputId,
  conceptInput,
  onConceptInputChange,
  conceptInputError,
  onConceptInputErrorChange,
  onSelectAllDetected,
  onClearSelection,
  detectedCount,
  selectionCount,
  selectAllNotice,
  onSwitchToManualTab,
  batchSelections,
  instanceLabels,
  aesthetic,
  activeBatch,
  onBatchRun,
  onBatchRetry,
  onRemoveLastSelection,
  onRemoveSelection,
}: DetectTabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={editorTabPanelId(tabIdBase, "detect")}
      aria-labelledby={editorTabId(tabIdBase, "detect")}
      hidden={hidden}
    >
      <div className="flex flex-col gap-3">
        {/* Issue #748: the base was rebased (a run completed) and
            refresh detection landed LAZY — no SAM call was billed
            for the new image. This button is the explicit refresh;
            concept chips and the Select Regions tool arm too. */}
        {!detectionArmed && imageUrl && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-atelier-taupe/40 bg-atelier-canvas px-3 py-2"
          >
            <p className="font-jakarta text-xs text-atelier-primary">
              New staged image — furnishings detection is paused to save quota.
            </p>
            <button
              type="button"
              onClick={onArmDetection}
              disabled={isProcessing}
              className="px-2.5 py-1 font-jakarta text-xs rounded-md border border-atelier-primary bg-white text-atelier-primary hover:bg-atelier-canvas transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              Detect furnishings
            </button>
          </div>
        )}
        {/* Issue #228: concept chips + validated free text. Chips
            enforce single-concept by construction; free text is
            validated with isValidConceptName (the server schema's
            client mirror) BEFORE any billed call can be built. */}
        <div className="flex flex-col gap-2">
          <div
            role="group"
            aria-label="Detection concept"
            aria-busy={conceptLoading}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="font-jakarta text-sm font-medium text-atelier-primary">Concept:</span>
            {CONCEPT_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                aria-pressed={requestedConcept === chip}
                disabled={isProcessing}
                onClick={() => onConceptChange(chip)}
                className={
                  requestedConcept === chip
                    ? "px-2.5 py-1 text-xs rounded-full border border-atelier-primary bg-atelier-primary text-white hover:bg-atelier-primary/80 transition-colors"
                    : "px-2.5 py-1 font-jakarta text-xs rounded-full border border-atelier-taupe/40 bg-white text-atelier-primary hover:bg-atelier-canvas transition-colors"
                }
              >
                {chip}
              </button>
            ))}
            {/* Issue #249/#474: bulk selection affordances. Select-all
                is a pure client-side walk over the decoded
                instances (zero billed calls); it stops at the
                batch cap and says so. When detection is running,
                the button is replaced with a spinner so the
                disabled state is not confusing (issue #474). */}
            {conceptLoading ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-atelier-primary bg-white text-atelier-taupe">
                <Loader2 className="h-3 w-3 animate-spin" />
                Detecting {requestedConcept}…
              </span>
            ) : (
              <button
                type="button"
                onClick={onSelectAllDetected}
                disabled={
                  isProcessing ||
                  detectedCount === 0 ||
                  selectionCount >= Math.min(detectedCount, MAX_BATCH_OBJECTS)
                }
                className="px-2.5 py-1 text-xs rounded-md border border-atelier-primary bg-white text-atelier-primary hover:bg-atelier-canvas transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                Select all detected
              </button>
            )}
            <button
              type="button"
              onClick={onClearSelection}
              disabled={isProcessing || selectionCount === 0}
              className="px-2.5 py-1 font-jakarta text-xs rounded-md border border-gray-300 bg-white text-stone-700 hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              Clear selection
            </button>
          </div>
          <form onSubmit={onConceptSubmit} className="flex flex-wrap items-center gap-2">
            <label htmlFor={conceptInputId} className="text-xs text-stone-600">
              Custom concept:
            </label>
            <input
              id={conceptInputId}
              type="text"
              value={conceptInput}
              onChange={(event) => {
                onConceptInputChange(event.target.value);
                if (conceptInputError) onConceptInputErrorChange(null);
              }}
              placeholder="e.g. wall art"
              className="w-44 rounded-md border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-stone-500"
            />
            <button
              type="submit"
              disabled={isProcessing}
              className="px-2.5 py-1 text-xs rounded-md border border-stone-800 bg-white text-stone-800 hover:bg-stone-100 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              Detect
            </button>
          </form>
          {conceptInputError && (
            <p role="alert" className="text-xs font-medium text-red-700">
              {conceptInputError}
            </p>
          )}
          {conceptLoading && (
            <p role="status" className="flex items-center gap-1.5 text-xs text-stone-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              Looking for {requestedConcept}…
            </p>
          )}
          {!conceptLoading && conceptStatus === "failed" && (
            <div className="flex flex-col gap-1">
              {conceptFailedReason === "service-unreachable" ? (
                <>
                  <p role="status" className="text-xs font-medium text-amber-700">
                    We could not reach the detection service. Try the Manual paint tab
                    instead, or try again later.
                  </p>
                  <button
                    type="button"
                    onClick={onSwitchToManualTab}
                    className="text-xs text-amber-700 underline hover:text-amber-900"
                  >
                    Paint the area manually instead
                  </button>
                </>
              ) : (
                <p role="status" className="text-xs font-medium text-amber-700">
                  Couldn&apos;t detect &quot;{requestedConcept}&quot; — try again, another
                  concept, or the brush.
                </p>
              )}
            </div>
          )}
          {!conceptLoading &&
            displayedResult &&
            displayedResult.concept === requestedConcept &&
            displayedResult.maskDataUrls.length === 0 && (
              <p role="status" className="text-xs text-stone-600">
                {buildConceptEmptyMessage(requestedConcept)}
              </p>
            )}
          {selectAllNotice && (
            <p role="status" className="text-xs text-stone-600">
              {selectAllNotice}
            </p>
          )}
        </div>

        {/* Issue #203 panel, fed since #229 by the concept toggles:
            appears once at least one detected instance has been
            toggled in. Thematic runs go through the shared
            single-run launcher; per-object plans execute sequentially
            with per-step progress and a retry affordance. The panel
            stays mounted across tab switches (hidden, not
            unmounted), so its prompts never reset (AC-L5). */}
        {batchSelections.length > 0 && (
          <BatchStagingPanel
            selections={batchSelections}
            maxObjects={MAX_BATCH_OBJECTS}
            disabled={isProcessing || conceptLoading}
            processing={isProcessing}
            activeBatch={activeBatch}
            onRun={onBatchRun}
            onRetryRemaining={onBatchRetry}
            onRemoveLast={onRemoveLastSelection}
            onRemoveSelection={onRemoveSelection}
            instanceLabels={instanceLabels}
            aesthetic={aesthetic}
          />
        )}
      </div>
    </div>
  );
}
