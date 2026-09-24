"use client";

import CollapsibleSection from "./collapsible-section";
import GeneratedVariationGrid, {
  type GeneratedVariation,
} from "./generated-variation-grid";
import VersionHistoryPanel from "./version-history-panel";

export interface InspectorFooterPanelsProps {
  roomId: string;
  roomName?: string;
  variantSlot: 0 | 1;
  /** Issue #630 generated-variation state (parent-owned). */
  generatedVariations: readonly GeneratedVariation[];
  selectedVariationId: string | null;
  onSelectVariation: (id: string) => void;
  isGeneratingVariations: boolean;
  variationProgress: string;
  onGenerateMore: () => void;
  onUseVariation: (variation: GeneratedVariation) => void;
  /** Issue #561 version history. */
  activeResultUrl: string | null;
  onActiveResultUrlChange: (url: string) => void;
  /** Collapsible-section controllers (issue #588). */
  generatedVariationsPanel: {
    isCollapsed: boolean;
    toggle: () => void;
  };
  variantPanel: {
    isCollapsed: boolean;
    toggle: () => void;
  };
}

/**
 * The two lower inspector sections (extracted from inpaint-editor.tsx by
 * #691): the #630 Generated Variation Grid and the #561 Version History
 * panel, each in its own collapsible section.
 */
export default function InspectorFooterPanels({
  roomId,
  roomName,
  variantSlot,
  generatedVariations,
  selectedVariationId,
  onSelectVariation,
  isGeneratingVariations,
  variationProgress,
  onGenerateMore,
  onUseVariation,
  activeResultUrl,
  onActiveResultUrlChange,
  generatedVariationsPanel,
  variantPanel,
}: InspectorFooterPanelsProps) {
  return (
    <>
      {/* Issue #630: Generated Variation Grid — 4-column grid of AI-generated
          inpainting variations the user can select and apply to the canvas. */}
      <CollapsibleSection
        id="generatedVariationsPanel"
        title="Generated Variations"
        isCollapsed={generatedVariationsPanel.isCollapsed}
        onToggle={generatedVariationsPanel.toggle}
      >
        <GeneratedVariationGrid
          roomName={roomName ?? "Room"}
          variations={generatedVariations}
          selectedId={selectedVariationId}
          isGenerating={isGeneratingVariations}
          generationProgress={variationProgress}
          onSelect={onSelectVariation}
          onGenerateMore={onGenerateMore}
          onUse={onUseVariation}
        />
      </CollapsibleSection>

      {/* Issue #561: Version History — collapsible panel at the bottom of the
          right pane, showing thumbnails of previous inpaint results. */}
      <CollapsibleSection
        id="variantPanel"
        title="Version History"
        isCollapsed={variantPanel.isCollapsed}
        onToggle={variantPanel.toggle}
      >
        <VersionHistoryPanel
          roomId={roomId}
          variantSlot={variantSlot}
          activeResultUrl={activeResultUrl}
          onRestored={onActiveResultUrlChange}
        />
      </CollapsibleSection>
    </>
  );
}
