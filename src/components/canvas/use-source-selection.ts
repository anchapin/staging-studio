"use client";

import { useCallback, useRef, useState } from "react";
import { inpaintSourcesEqual, type InpaintSource } from "@/lib/inpaint-source";

export interface UseSourceSelectionInput {
  source: InpaintSource;
  onSourceChange?: (source: InpaintSource) => void;
  /** Drops the painted mask on a switch (masks belong to one image). */
  clearMask: () => void;
  /** Concept-hook session reset (incl. the #748 user-switch arming). */
  resetForUserSourceSwitch: () => void;
  /** Composer cache clear (region masks belong to the old image). */
  clearRegionMaskCache: () => void;
}

/**
 * "Edit from" source switching with undo (issue #691 extraction from
 * inpaint-editor.tsx): switching drops the mask, the selection session,
 * and the region-mask cache — anything segmented against the previous
 * image must not leak into the next run (issues #170/#203/#378/#748).
 */
export function useSourceSelection({
  source,
  onSourceChange,
  clearMask,
  resetForUserSourceSwitch,
  clearRegionMaskCache,
}: UseSourceSelectionInput) {
  // Issue #378: source change undo state
  const previousSourceRef = useRef<InpaintSource | null>(null);
  const [canUndoSource, setCanUndoSource] = useState(false);

  // Switching source swaps the image being edited — any existing mask was
  // drawn for the previous image and must not leak into the next run. The
  // segment cache is dropped with it (issue #202/#228 lifecycle: one
  // session per image), and the concept session resets to the default.
  const handleSourceChange = useCallback(
    (next: InpaintSource) => {
      if (inpaintSourcesEqual(next, source)) return;
      // Issue #378: save current source for undo before switching
      previousSourceRef.current = source;
      setCanUndoSource(true);
      clearMask();
      // Issue #203: masks (and the selection set that produced them) were
      // segmented against the previous image — they must not leak. The
      // union/reset state follows the selection set via effects. The
      // detection/selection session reset (incl. the #748 user-switch
      // arming) lives in the concept hook.
      resetForUserSourceSwitch();
      clearRegionMaskCache();
      onSourceChange?.(next);
    },
    [source, onSourceChange, clearMask, resetForUserSourceSwitch, clearRegionMaskCache]
  );

  // Issue #378: undo source change by restoring the previous source
  const handleUndoSource = useCallback(() => {
    if (!previousSourceRef.current) return;
    const prev = previousSourceRef.current;
    // Restore the previous source by calling handleSourceChange with the previous source
    // This will trigger the full reset logic that handleSourceChange does
    previousSourceRef.current = source;
    clearMask();
    // Undo is a user-driven source switch — same session reset, then arm
    // the restored base (issue #748).
    resetForUserSourceSwitch();
    clearRegionMaskCache();
    onSourceChange?.(prev);
  }, [source, onSourceChange, clearMask, resetForUserSourceSwitch, clearRegionMaskCache]);

  return { canUndoSource, handleSourceChange, handleUndoSource };
}
