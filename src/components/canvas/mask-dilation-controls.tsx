"use client";

import { Info } from "lucide-react";
import { MAX_MASK_EXPANSION_RADIUS } from "@/lib/mask-dilation";
import { sliderFillStyle } from "@/lib/precision-slider";

export interface MaskDilationControlsProps {
  /** Hide in Zen/Focus modes (the whole block tints away). */
  hidden: boolean;
  /** Issue #180: outward mask growth in mask-canvas pixels. */
  maskExpansion: number;
  onMaskExpansionChange: (radius: number) => void;
  /** Issue #234: dilate further downward to swallow cast floor shadows. */
  includeFloorShadow: boolean;
  onIncludeFloorShadowChange: (included: boolean) => void;
}

/**
 * Expand-selection + floor-shadow controls under the mask canvas
 * (issues #180/#234; extracted from inpaint-editor.tsx by #691).
 */
export default function MaskDilationControls({
  hidden,
  maskExpansion,
  onMaskExpansionChange,
  includeFloorShadow,
  onIncludeFloorShadowChange,
}: MaskDilationControlsProps) {
  return (
    <div className={hidden ? "zen-mode-hidden" : ""}>
      <label className="flex items-center gap-2 font-jakarta text-sm text-atelier-primary">
        Expand selection:
        <input
          type="range"
          min={0}
          max={MAX_MASK_EXPANSION_RADIUS}
          value={maskExpansion}
          onChange={(e) => onMaskExpansionChange(Number(e.target.value))}
          aria-describedby="mask-expansion-hint"
          className="atelier-slider w-32"
          style={sliderFillStyle(maskExpansion, 0, MAX_MASK_EXPANSION_RADIUS)}
        />
        <span className="w-10 text-right tabular-nums font-medium">{maskExpansion}px</span>
      </label>
      <p id="mask-expansion-hint" className="text-xs text-atelier-taupe">
        Grows the painted area so picture frames, bezels, and mounts are
        included. 0 keeps the exact painted area.
      </p>

      {/* Issue #234: floor-shadow toggle — dilates the mask further downward than
          upward so cast shadows on the floor are included in the regenerated region. */}
      <label className="flex items-center gap-2 font-jakarta text-sm text-atelier-primary">
        <input
          type="checkbox"
          checked={includeFloorShadow}
          onChange={(e) => onIncludeFloorShadowChange(e.target.checked)}
          className="h-4 w-4 accent-atelier-primary"
        />
        Add natural floor shadows under new furniture
      </label>
      <div className="flex items-center gap-1">
        <span
          role="img"
          aria-label="More info"
          title="Extends the painted area downward to include floor shadows, so they look natural with the new furniture. Best for hard floors."
          className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-atelier-taupe/30 text-atelier-taupe hover:bg-atelier-taupe/50"
        >
          <Info className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}
