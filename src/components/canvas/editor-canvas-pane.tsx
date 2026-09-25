"use client";

import type { ReactNode } from "react";
import CollapsibleSection from "./collapsible-section";
import InpaintMaskCanvas, { type MaskTool } from "./inpaint-mask-canvas";
import SourceImageHeader from "./source-image-header";
import MaskDilationControls from "./mask-dilation-controls";
import type { SelectionReset } from "./inpaint-mask-canvas";
import type { InstanceOverlay, SelectionMarker } from "@/lib/instance-overlays";

export interface EditorCanvasPaneProps {
  /** Issue #252 D5: full-width focused layout (issue #169). */
  fullWidth: boolean;
  /** Issue #252 D5: focused page's room imagery slot, above the canvas. */
  secondaryPane?: ReactNode;
  /** Issue #588 Room Details collapsible controller. */
  promptPanel: { isCollapsed: boolean; toggle: () => void };
  /** Workspace modes (hide chrome). */
  zenMode: boolean;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  onToggleZenMode: () => void;
  /** Issue #781: Before/after comparison toggle. */
  showBefore: boolean;
  onToggleShowBefore: () => void;
  /** Mask canvas props (forwarded verbatim). */
  imageUrl: string;
  activeResultUrl: string | null;
  aspectRatio: number | null;
  naturalWidth: number | null;
  naturalHeight: number | null;
  initialMaskDataUrl: string | null;
  onMaskChange: (maskDataUrl: string | null) => void;
  onInstanceToggle: (point: { x: number; y: number }) => void;
  segmentDisabled: boolean;
  processing: boolean;
  segmenting: boolean;
  detectingConcept?: string;
  instanceOverlays?: InstanceOverlay[];
  selectionMarkers?: SelectionMarker[];
  expansionRadius: number;
  includeFloorShadow: boolean;
  selectionReset: SelectionReset | null;
  onMaskCleared: () => void;
  onSelectionDeselect: (id: string) => void;
  onSelectRegionsActivate: () => void;
  /** Issue #560: Zen Mode lifted brush state. */
  zenBrushSize: number;
  onZenBrushSizeChange: (size: number) => void;
  zenActiveTool: MaskTool;
  onZenActiveToolChange: (tool: MaskTool) => void;
  /** Dilation controls (issues #180/#234). */
  maskExpansion: number;
  onMaskExpansionChange: (radius: number) => void;
  onIncludeFloorShadowChange: (included: boolean) => void;
}

/**
 * The editor's LEFT PANE (issue #691 extraction from inpaint-editor.tsx):
 * the optional Room Details slot (#252 D5), the sticky Source Image header
 * (#547/#546), the mask canvas, and the dilation controls (#180/#234).
 */
export default function EditorCanvasPane({
  fullWidth,
  secondaryPane,
  promptPanel,
  zenMode,
  focusMode,
  onToggleFocusMode,
  onToggleZenMode,
  showBefore,
  onToggleShowBefore,
  imageUrl,
  activeResultUrl,
  aspectRatio,
  naturalWidth,
  naturalHeight,
  initialMaskDataUrl,
  onMaskChange,
  onInstanceToggle,
  segmentDisabled,
  processing,
  segmenting,
  detectingConcept,
  instanceOverlays,
  selectionMarkers,
  expansionRadius,
  includeFloorShadow,
  selectionReset,
  onMaskCleared,
  onSelectionDeselect,
  onSelectRegionsActivate,
  zenBrushSize,
  onZenBrushSizeChange,
  zenActiveTool,
  onZenActiveToolChange,
  maskExpansion,
  onMaskExpansionChange,
  onIncludeFloorShadowChange,
}: EditorCanvasPaneProps) {
  const overlayImageSrc = showBefore ? imageUrl : (activeResultUrl ?? imageUrl);
  return (
    <div
      className={`flex min-w-0 flex-col gap-4 ${
        fullWidth ? "md:min-h-0 lg:min-h-0 lg:flex-1" : ""
      }`}
    >
      {secondaryPane && (
        <CollapsibleSection
          id="promptPanel"
          title="Room Details"
          isCollapsed={promptPanel.isCollapsed}
          onToggle={promptPanel.toggle}
          className={zenMode || focusMode ? "zen-mode-hidden" : ""}
        >
          <div
            className={`flex flex-col gap-6 ${
              fullWidth ? "md:max-h-none md:overflow-visible lg:max-h-[70%] lg:min-h-0 lg:overflow-y-auto" : ""
            }`}
          >
            {secondaryPane}
          </div>
        </CollapsibleSection>
      )}
      {/* Issue #560: "Source Image" label hidden in Zen Mode */}
      {/* Issue #638: sticky header hidden in Focus Canvas Mode */}
      {/* Issue #547/#546: sticky header per Atelier Canvas spec with Atelier Canvas colors */}
      <SourceImageHeader
        zenMode={zenMode}
        focusMode={focusMode}
        showBefore={showBefore}
        onToggleFocusMode={onToggleFocusMode}
        onToggleZenMode={onToggleZenMode}
        onToggleShowBefore={onToggleShowBefore}
      />
      {/* Issue #460: comparison now via staged result image click in secondary pane */}
      <InpaintMaskCanvas
        overlayImageSrc={overlayImageSrc}
        aspectRatio={aspectRatio}
        naturalWidth={naturalWidth}
        naturalHeight={naturalHeight}
        initialMaskDataUrl={initialMaskDataUrl}
        onMaskChange={onMaskChange}
        onInstanceToggle={onInstanceToggle}
        segmentDisabled={segmentDisabled}
        processing={processing}
        segmenting={segmenting}
        detectingConcept={detectingConcept}
        instanceOverlays={instanceOverlays}
        selectionMarkers={selectionMarkers}
        expansionRadius={expansionRadius}
        includeFloorShadow={includeFloorShadow}
        fullWidth={fullWidth}
        selectionReset={selectionReset}
        onMaskCleared={onMaskCleared}
        onSelectionDeselect={onSelectionDeselect}
        zenMode={zenMode}
        brushSize={zenMode ? zenBrushSize : undefined}
        onBrushSizeChange={zenMode ? onZenBrushSizeChange : undefined}
        activeTool={zenMode ? zenActiveTool : undefined}
        onActiveToolChange={zenMode ? onZenActiveToolChange : undefined}
        onSelectRegionsActivate={onSelectRegionsActivate}
      />

      {/* Issue #560: expand selection and floor shadow controls hidden in Zen Mode */}
      {/* Issue #638: hidden in Focus Canvas Mode */}
      <MaskDilationControls
        hidden={zenMode || focusMode}
        maskExpansion={maskExpansion}
        onMaskExpansionChange={onMaskExpansionChange}
        includeFloorShadow={includeFloorShadow}
        onIncludeFloorShadowChange={onIncludeFloorShadowChange}
      />
    </div>
  );
}
