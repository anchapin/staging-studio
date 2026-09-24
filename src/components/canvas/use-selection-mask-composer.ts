"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BatchSelection } from "@/lib/multi-select-batch";
import { MERGE_PROXIMITY_PX } from "@/lib/mask-postprocess";
import {
  composeRegionMaskDataUrl,
  composeUnionMaskDataUrl,
  type DecodedInstance,
} from "./mask-composition";
import type { SelectionReset } from "./inpaint-mask-canvas";

export interface UseSelectionMaskComposerInput {
  /** The batch selection set whose masks get composed. */
  batchSelections: BatchSelection[];
  setBatchSelections: React.Dispatch<React.SetStateAction<BatchSelection[]>>;
  /** Decoded concept instances (member white masks for region recomposition). */
  decodedInstances: Array<DecodedInstance | null> | null;
  /** Natural dimensions of the base photo. */
  imageDims: { width: number; height: number } | null;
}

/**
 * Selection-mask composer (issue #691 extraction from inpaint-editor.tsx):
 * keeps the union mask (thematic runs + the batch panel) and the canvas's
 * selection reset in lockstep with the batch selection set, and recomposes
 * merged regions' masks from their members.
 *
 * Everything here is a verbatim move; see inpaint-editor.tsx for the
 * original comment trail (issues #203/#229/#252 D2/D3).
 */
export function useSelectionMaskComposer({
  batchSelections,
  setBatchSelections,
  decodedInstances,
  imageDims,
}: UseSelectionMaskComposerInput) {
  const [unionMaskDataUrl, setUnionMaskDataUrl] = useState<string | null>(null);
  const [selectionReset, setSelectionReset] = useState<SelectionReset | null>(null);
  const selectionResetIdRef = useRef(0);

  // Issue #203 (simplified by #229): keep the union mask (for thematic
  // runs + the batch panel) and the canvas's selection reset in lockstep
  // with the batch selection set — since #229 the toggled concept
  // instances ARE that set, so one source drives everything. The reset
  // carries an incrementing id so every change applies exactly once; an
  // empty set resets the grid to black (Clear Mask semantics). Concept
  // masks arrive as white-on-black data URLs at the photo's natural
  // dimensions, the same geometry the batch set is normalized to, so
  // `composeUnionMaskDataUrl` takes them unchanged.
  useEffect(() => {
    if (!imageDims) return;
    let cancelled = false;
    const compose = async () => {
      const unionUrl =
        batchSelections.length > 0
          ? await composeUnionMaskDataUrl(
              batchSelections.map((selection) => selection.maskDataUrl),
              imageDims.width,
              imageDims.height
            )
          : null;
      if (cancelled) return;
      setUnionMaskDataUrl(unionUrl);
      selectionResetIdRef.current += 1;
      setSelectionReset({ id: selectionResetIdRef.current, maskDataUrl: unionUrl });
    };
    void compose();
    return () => {
      cancelled = true;
    };
  }, [batchSelections, imageDims]);

  // Issue #252 D2: keep merged regions' masks composed from their members —
  // union → closing → hole fill at the photo's natural dimensions (WYSIWYG:
  // the canvas tint, the dispatched per-region mask, and the thematic union
  // all agree). Single-instance regions keep their decoded white mask, so
  // only multi-member regions are recomposed here. The cache is keyed by
  // id + membership, so a merge that later gains another member recomposes
  // exactly once.
  const regionMaskCacheRef = useRef(new Map<string, string>());
  useEffect(() => {
    if (!imageDims) return;
    const pending = batchSelections.filter((selection) => {
      const members = selection.memberInstanceIndices;
      if (!members || members.length <= 1) return false;
      const key = `${selection.id}:${members.join(",")}`;
      return regionMaskCacheRef.current.get(key) !== selection.maskDataUrl;
    });
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      const gridEntry = decodedInstances?.find((instance) => instance) ?? null;
      const naturalLong = Math.max(imageDims.width, imageDims.height);
      const gridLong = gridEntry
        ? Math.max(gridEntry.width, gridEntry.height)
        : naturalLong;
      // MERGE_PROXIMITY_PX is defined in mask-canvas grid pixels; scale it
      // to the natural-dimension space the region masks live in.
      const closeRadius = Math.max(1, Math.round(MERGE_PROXIMITY_PX * (naturalLong / gridLong)));
      for (const selection of pending) {
        const members = selection.memberInstanceIndices ?? [];
        const memberUrls = members
          .map((index) => decodedInstances?.[index]?.whiteMaskDataUrl)
          .filter((url): url is string => Boolean(url));
        if (memberUrls.length !== members.length) continue;
        const url = await composeRegionMaskDataUrl(
          memberUrls,
          imageDims.width,
          imageDims.height,
          closeRadius
        );
        if (cancelled) return;
        if (!url) continue;
        const key = `${selection.id}:${members.join(",")}`;
        regionMaskCacheRef.current.set(key, url);
        setBatchSelections((previous) =>
          previous.map((candidate) =>
            candidate.id === selection.id &&
            (candidate.memberInstanceIndices ?? []).join(",") === members.join(",")
              ? { ...candidate, maskDataUrl: url }
              : candidate
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batchSelections, imageDims, decodedInstances, setBatchSelections]);

  // Source switches drop the region cache with the selection set — masks
  // (and the compositions they seeded) were built against the previous
  // image and must not leak into the next run.
  const clearRegionMaskCache = useCallback(() => {
    regionMaskCacheRef.current.clear();
  }, []);

  return {
    unionMaskDataUrl,
    selectionReset,
    clearRegionMaskCache,
  };
}
