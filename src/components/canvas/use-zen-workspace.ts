"use client";

import { useCallback, useState } from "react";
import { type MaskTool } from "./inpaint-mask-canvas";
import { type StudioTool } from "./BrushToolRail";

export interface UseZenWorkspaceResult {
  /** Issue #560: Zen Mode — hides all chrome for a distraction-free workspace. */
  zenMode: boolean;
  setZenMode: React.Dispatch<React.SetStateAction<boolean>>;
  /** Issue #560: dark background toggle for eye comfort in Zen Mode. */
  zenDarkBackground: boolean;
  /** Issue #638: Focus Canvas Mode — collapses header and inspector simultaneously. */
  focusMode: boolean;
  setFocusMode: React.Dispatch<React.SetStateAction<boolean>>;
  /** Issue #560: lifted brush state — shared between InpaintMaskCanvas and the tool rail. */
  zenBrushSize: number;
  setZenBrushSize: (size: number) => void;
  zenActiveTool: MaskTool;
  setZenActiveTool: (tool: MaskTool) => void;
  /** Issue #627: Brush Tool Rail state — full tool rail + parameter flyout. */
  studioActiveTool: StudioTool;
  setStudioActiveTool: (tool: StudioTool) => void;
  brushRadius: number;
  setBrushRadius: (radius: number) => void;
  brushEdgeSoftness: number;
  setBrushEdgeSoftness: (softness: number) => void;
  brushMaskOpacity: number;
  setBrushMaskOpacity: (opacity: number) => void;
  handleStudioToolChange: (tool: StudioTool) => void;
}

/**
 * Zen/Focus workspace + brush-tool-rail state (issue #691 extraction from
 * inpaint-editor.tsx): the #560 zen mode chrome-hiding state, the #638
 * focus canvas mode, and the #560/#627 lifted brush state shared between
 * the mask canvas and the floating tool rail.
 */
export function useZenWorkspace(onSelectRegionsTool: () => void): UseZenWorkspaceResult {
  // Issue #560: Zen Mode state — hides all chrome for a distraction-free workspace.
  const [zenMode, setZenMode] = useState(false);
  // Issue #560: dark background toggle for eye comfort in Zen Mode.
  const [zenDarkBackground] = useState(false);

  // Issue #638: Focus Canvas Mode state — collapses header and inspector simultaneously.
  const [focusMode, setFocusMode] = useState(false);

  // Issue #560: lifted brush state — shared between InpaintMaskCanvas and ZenModeToolbar.
  const [zenBrushSize, setZenBrushSize] = useState(20);
  const [zenActiveTool, setZenActiveTool] = useState<MaskTool>("brush");

  // Issue #627: Brush Tool Rail state — lifted state for the full tool rail + parameter flyout.
  const [studioActiveTool, setStudioActiveTool] = useState<StudioTool>("brush");
  const [brushRadius, setBrushRadius] = useState(42);
  const [brushEdgeSoftness, setBrushEdgeSoftness] = useState(35);
  const [brushMaskOpacity, setBrushMaskOpacity] = useState(80);

  // Issue #748: activating the Select Regions tool is an explicit refresh
  // signal for a lazily-detected base — the caller arms (and bills) the
  // SAM call for the current base.
  const handleStudioToolChange = useCallback(
    (tool: StudioTool) => {
      setStudioActiveTool(tool);
      if (tool === "select") onSelectRegionsTool();
    },
    [onSelectRegionsTool]
  );

  return {
    zenMode,
    setZenMode,
    zenDarkBackground,
    focusMode,
    setFocusMode,
    zenBrushSize,
    setZenBrushSize,
    zenActiveTool,
    setZenActiveTool,
    studioActiveTool,
    setStudioActiveTool,
    brushRadius,
    setBrushRadius,
    brushEdgeSoftness,
    setBrushEdgeSoftness,
    brushMaskOpacity,
    setBrushMaskOpacity,
    handleStudioToolChange,
  };
}
