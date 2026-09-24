"use client";

import BrushToolRail, {
  BrushParameterFlyout,
  CanvasZoomHud,
  type StudioTool,
} from "./BrushToolRail";

export interface ZenToolRailProps {
  /** Issue #627: lifted tool-rail state (shared with the editor). */
  studioActiveTool: StudioTool;
  onStudioToolChange: (tool: StudioTool) => void;
  /** Brush parameter flyout state (brush tool only). */
  brushRadius: number;
  onBrushRadiusChange: (radius: number) => void;
  brushEdgeSoftness: number;
  onBrushEdgeSoftnessChange: (softness: number) => void;
  brushMaskOpacity: number;
  onBrushMaskOpacityChange: (opacity: number) => void;
  onCloseFlyout: () => void;
}

/**
 * Issue #616: Floating glassmorphic canvas tool rail — left-anchored
 * stack (1.5rem from viewport edges) with the tool strip, brush parameter
 * flyout, and zoom HUD. Shown when Zen Mode is active (extracted from
 * inpaint-editor.tsx by #691).
 */
export default function ZenToolRail({
  studioActiveTool,
  onStudioToolChange,
  brushRadius,
  onBrushRadiusChange,
  brushEdgeSoftness,
  onBrushEdgeSoftnessChange,
  brushMaskOpacity,
  onBrushMaskOpacityChange,
  onCloseFlyout,
}: ZenToolRailProps) {
  return (
    <div className="fixed left-6 top-6 z-50 flex flex-col items-start gap-3">
      <BrushToolRail
        activeTool={studioActiveTool}
        onToolChange={onStudioToolChange}
      />
      {studioActiveTool === "brush" && (
        <BrushParameterFlyout
          radius={brushRadius}
          edgeSoftness={brushEdgeSoftness}
          maskOpacity={brushMaskOpacity}
          onRadiusChange={onBrushRadiusChange}
          onEdgeSoftnessChange={onBrushEdgeSoftnessChange}
          onMaskOpacityChange={onBrushMaskOpacityChange}
          onClose={onCloseFlyout}
        />
      )}
      <CanvasZoomHud />
    </div>
  );
}
