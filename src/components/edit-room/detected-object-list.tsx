/**
 * Issue #1341 — `<DetectedObjectList>` (Objects-scope sub-panel body).
 *
 * Renders the decoded-instance array filtered to the active concept.
 * One row per object with a checkbox + human-readable label. The
 * header carries the "{N} found · click on the photo or here" copy
 * and a "Clear" affordance that only renders when ≥1 object is
 * selected.
 *
 * Pure function of props. The shell wires `selected` + `onToggleObject`
 * + `onClearSelection` to the reducer; the list never owns selection
 * state. Mirrors the Magic Patterns draft at
 * `dVy8jC2kXpi1ca8b4A1hcS/components/StagePanel.tsx`'s "found" list
 * (lines 142–172) without the `lucide-react` `Search` icon dependency.
 *
 * Pinned 1:1 by `tests/edit-room-detected-object-list.test.tsx`.
 *
 * The `DetectedObject` shape here is shared with `CanvasStage` (the
 * detection labels on the canvas itself). Re-declaring the type with
 * the same fields keeps the test isolated from the canvas module so
 * a future canvas refactor can't break the panel's pinning.
 */

import type { ReactNode } from "react";

export interface DetectedObject {
  id: string;
  /** The detection concept at the time of detection. */
  concept: string;
  /** Human-readable label, e.g. "Floor lamp" vs the bare concept. */
  label: string;
  /** Position in % of the source image (not rendered by this component). */
  box: { x: number; y: number; w: number; h: number };
}

export interface DetectedObjectListProps {
  /** The filtered set — typically `decodedInstances.filter(d => d.concept === activeConcept)`. */
  found: ReadonlyArray<DetectedObject>;
  /** Ids the user has currently selected (drives the checkbox state). */
  selected: ReadonlyArray<string>;
  /** Toggle handler — fired with the clicked row's id. */
  onToggleObject: (id: string) => void;
  /** Clears the entire selection (fired by the Clear affordance). */
  onClearSelection: () => void;
}

/**
 * Renders the detection list as the body of the Objects-scope sub-panel.
 * The list is wrapped in a `<div>` with `border-line-soft` so it reads
 * as a single card; each row is a label-wrapped checkbox so clicking
 * the label text or the box itself toggles the selection.
 */
export function DetectedObjectList({
  found,
  selected,
  onToggleObject,
  onClearSelection,
}: DetectedObjectListProps): ReactNode {
  return (
    <div className="rounded-lg border border-line-soft">
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
        <p className="text-xs text-ink-subtle">
          {found.length} found · click on the photo or here
        </p>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClearSelection}
            className="text-xs font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>
      <ul>
        {found.map((d) => (
          <li key={d.id}>
            <label
              data-object-id={d.id}
              className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-ink transition-colors duration-150 hover:bg-surface-low"
            >
              <input
                type="checkbox"
                checked={selected.includes(d.id)}
                onChange={() => onToggleObject(d.id)}
                className="h-4 w-4 accent-walnut"
              />
              {d.label}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}