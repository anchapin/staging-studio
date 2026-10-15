/**
 * Issue #1339 — CanvasStage + MaskLayer + CompareLayer + on-canvas object boxes.
 *
 * `ObjectOverlay` is the on-canvas `<button>` rendered for each detected
 * object when `scope === "objects"`. It is a thin visual wrapper: the
 * button is positioned by percent over the photo, gets a dashed white
 * border when unselected and a solid bronze border when selected, and
 * shows a label tag in the top-left corner.
 *
 * Magic Patterns reference:
 * `dVy8jC2kXpi1ca8b4A1hcS/components/CanvasStage.tsx` lines 137–168.
 *
 * Visual contract (pinned by `tests/edit-room-object-overlay.test.tsx`):
 *  - aria-pressed reflects `selected` (screen-reader contract)
 *  - aria-label = the object's label (e.g. "Sofa") — the e2e spec
 *    targets buttons by role + name without a CSS selector
 *  - Unselected: dashed 2px white border at 0% fill, walnut/80 label
 *    background, no ✓ prefix
 *  - Selected: solid 2px bronze border at 25% bronze fill, bronze label
 *    background with ✓ prefix
 *  - Hover: white/15 wash on unselected buttons so they telegraph
 *    interactivity without competing with the photo
 *
 * Persistence: the parent (`CanvasStage`) owns the `selected` array
 * (lifted from the reducer) and toggles via `onToggle(id)`. This
 * component does NOT own state — selecting an object is a reducer
 * action, not local UI.
 */

import type { CSSProperties } from "react";

import { objectBoxToStyle, type ObjectBoundingBox } from "@/lib/canvas-coords";

export interface ObjectOverlayProps {
  /** Stable React key (the parent supplies it from the detection list). */
  id: string;
  /** Percent-based box from the detection. */
  box: ObjectBoundingBox;
  /** Human-readable label ("Sofa", "Floor lamp", …). */
  label: string;
  /** True iff this object is in the parent's selection set. */
  selected: boolean;
  /** Toggles the object in the parent's selection set. */
  onToggle: (id: string) => void;
}

/** Stable id supplier — the parent passes the detection's stable id. */
export function ObjectOverlay({ id, box, label, selected, onToggle }: ObjectOverlayProps) {
  // `objectBoxToStyle` clamps hostile inputs so a malformed provider
  // response (x = -30%, y = NaN, …) never produces `"NaN%"` in the DOM.
  const style = objectBoxToStyle(box) satisfies CSSProperties;
  return (
    <button
      key={id}
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={() => onToggle(id)}
      className={`group absolute rounded-md transition-colors duration-150 ${
        selected
          ? "border-2 border-bronze bg-bronze/25"
          : "border-2 border-dashed border-white/90 bg-white/0 hover:bg-white/15"
      }`}
      style={style}
    >
      <span
        className={`absolute left-1.5 top-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${
          selected ? "bg-bronze text-white" : "bg-walnut/80 text-on-walnut"
        }`}
      >
        {selected ? "✓ " : ""}
        {label}
      </span>
    </button>
  );
}