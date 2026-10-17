/**
 * Issue #1195: the inspector header describes the current selection in a
 * designer's terms instead of the static "Active Inpaint Zone" title.
 * Pure so it can be unit-tested without rendering the editor.
 */

export interface InspectorHeadingInput {
  /** The editor tab currently shown ("entire" | "manual" | "detect"). */
  effectiveTab: string;
  /** Pending multi-select regions; only their concept labels matter here. */
  batchSelections?: ReadonlyArray<{ conceptLabel?: string | null }> | null;
  /** True when a hand-brushed mask exists on the manual tab. */
  hasPaintedMask: boolean;
}

export interface InspectorHeading {
  /** Heading text, e.g. "Editing: Sofa". */
  title: string;
  /** Short hint shown under the title when nothing is selected. */
  hint: string | null;
  /** True when something is selected (drives the muted empty style). */
  hasSelection: boolean;
}

export const EMPTY_HEADING_TITLE = "Select something to edit";
export const EMPTY_HEADING_HINT = "Click an object or brush an area";

function toDisplayLabel(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function inspectorHeading({
  effectiveTab,
  batchSelections,
  hasPaintedMask,
}: InspectorHeadingInput): InspectorHeading {
  const editing = (what: string): InspectorHeading => ({
    title: `Editing: ${what}`,
    hint: null,
    hasSelection: true,
  });

  if (effectiveTab === "entire") return editing("Whole room");

  const selections = batchSelections ?? [];
  if (effectiveTab === "detect" || selections.length > 0) {
    if (selections.length > 1) return editing(`${selections.length} areas`);
    if (selections.length === 1) {
      const label = toDisplayLabel(selections[0].conceptLabel ?? "");
      return editing(label || "1 area");
    }
  }

  if (effectiveTab === "manual" && hasPaintedMask) {
    return editing("Brushed area");
  }

  return {
    title: EMPTY_HEADING_TITLE,
    hint: EMPTY_HEADING_HINT,
    hasSelection: false,
  };
}
