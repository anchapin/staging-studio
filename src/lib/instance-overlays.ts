import { topmostLeftmostPoint } from "@/lib/vision-labels";
import type { BatchSelection } from "@/lib/multi-select-batch";

/**
 * Issue #228: one detected concept instance to tint on the overlay
 * canvas. `rank` is the score rank (0 = highest score) and picks the
 * palette color; issue #249 splits the rendering — `selected` instances
 * render as a solid rank-colored fill (their pixels are already in the
 * white mask canvas above), detected-only ones as a faint wash with a
 * rank-colored outline.
 *
 * Extracted from inpaint-mask-canvas.tsx by issue #691 so the pure
 * overlay-derivation lives beside its test.
 */
export interface InstanceOverlay {
  /** Stable React key (concept + response position). */
  id: string;
  /** The provider mask (data URL; grayscale or alpha cutout) to tint. */
  maskDataUrl: string;
  /** Score rank, 0-based. */
  rank: number;
  selected: boolean;
  /**
   * Issue #252 D4: when the instance is SELECTED, its region's palette
   * slot (region position in the batch set) — every member of a merged
   * region tints with the SAME color, matching its numbered badge and the
   * panel chip. Unset (or for unselected instances) the rank color is used.
   */
  colorIndex?: number;
}

/** Issue #203: one numbered badge marking a pending batch selection. */
export interface SelectionMarker {
  id: string;
  /** Click point in the photo's natural pixel space. */
  x: number;
  y: number;
  /** 1-based position in the selection set. */
  index: number;
}

/** Structural shape of a decoded detection instance the builders reason about. */
export interface OverlayInstanceGrid {
  grid: Uint8Array;
  width: number;
  height: number;
}

/** Structural shape of the displayed detection result the builders read. */
export interface OverlayDetectionResult {
  concept: string;
  maskDataUrls: string[];
}

/**
 * Overlay descriptors for the canvas's tinted instance layer (issue
 * #228). Since issue #252 D2/D4, SELECTED instances tint with their
 * REGION's palette color (all members of a merged region share one color
 * — matching the region's badge and panel chip); detected-only instances
 * keep their score-rank color.
 *
 * Pure derivation extracted 1:1 from the inpaint-editor useMemo.
 */
export function buildInstanceOverlays(
  displayedResult: OverlayDetectionResult,
  decodedInstances: Array<OverlayInstanceGrid | null>,
  batchSelections: readonly BatchSelection[],
  selectedInstanceIndices: readonly number[]
): InstanceOverlay[] {
  const regionIndexByInstance = new Map<number, number>();
  batchSelections.forEach((selection, position) => {
    for (const member of selection.memberInstanceIndices ?? []) {
      regionIndexByInstance.set(member, position);
    }
  });
  const overlays: InstanceOverlay[] = [];
  for (let index = 0; index < displayedResult.maskDataUrls.length; index++) {
    const instance = decodedInstances[index];
    if (!instance) continue;
    const selected = selectedInstanceIndices.includes(index);
    const regionIndex = regionIndexByInstance.get(index);
    overlays.push({
      id: `${displayedResult.concept}:${index}`,
      maskDataUrl: displayedResult.maskDataUrls[index],
      rank: index,
      selected,
      ...(selected && regionIndex !== undefined ? { colorIndex: regionIndex } : {}),
    });
  }
  return overlays;
}

/**
 * Issue #252 D4: numbered canvas badges, one per pending region, positioned
 * at the topmost-leftmost pixel of the region's member union (grid space
 * scaled to natural pixels) so a merged region is anchored on its actual
 * shape rather than any single member's seed point.
 *
 * Pure derivation extracted 1:1 from the inpaint-editor useMemo. The
 * grid→natural scale factors mirror the original: derived from the FIRST
 * decoded instance's grid geometry (falling back to 1:1 against the
 * natural dims when no instance has decoded yet).
 */
export function buildSelectionMarkers(
  batchSelections: readonly BatchSelection[],
  decodedInstances: Array<OverlayInstanceGrid | null> | null,
  imageDims: { width: number; height: number }
): SelectionMarker[] {
  if (!decodedInstances || batchSelections.length === 0) return [];
  return batchSelections.flatMap((selection, position) => {
    const members = selection.memberInstanceIndices ?? [];
    // Union's topmost-leftmost pixel = the minimum (y, then x) over the
    // members' own topmost-leftmost points (D4).
    let best: { x: number; y: number } | null = null;
    for (const member of members) {
      const instance = decodedInstances[member];
      if (!instance) continue;
      const point = topmostLeftmostPoint(instance.grid, instance.width, instance.height);
      if (!point) continue;
      if (!best || point.y < best.y || (point.y === best.y && point.x < best.x)) best = point;
    }
    if (!best) return [];
    return [
      {
        id: selection.id,
        x: best.x * (imageDims.width / (decodedInstances[0]?.width ?? imageDims.width)),
        y: best.y * (imageDims.height / (decodedInstances[0]?.height ?? imageDims.height)),
        index: position + 1,
      },
    ];
  });
}
