"use client";

import React from "react";
import CollapsibleSection from "@/components/canvas/collapsible-section";
import EditorTabBar from "@/components/canvas/editor-tab-bar";
import EntireTabPanel from "@/components/canvas/entire-tab-panel";
import ManualTabPanel from "@/components/canvas/manual-tab-panel";
import DetectTabPanel from "@/components/canvas/detect-tab-panel";
import InspectorHeader from "@/components/canvas/inspector-header";
import InspectorCollapsedRail from "@/components/canvas/inspector-collapsed-rail";
import InspectorFooterPanels from "@/components/canvas/inspector-footer-panels";
import SourceSelectorFieldset from "@/components/canvas/source-selector-fieldset";

 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProps = Record<string, any>;

 
type EditorInspectorColumnProps = AnyProps;

export function EditorInspectorColumn({
  fullWidth,
  inspectorView,
  inspectorPanel,
  handleInspectorRailExpand,
  brushPanel,
  sourceOptions,
  source,
  isProcessing,
  handleSourceChange,
  canUndoSource,
  handleUndoSource,
  editorTabs,
  effectiveTab,
  handleTabSelect,
  tabIdBase,
  saveStatus,
  roomId,
  imageUrl,
  aesthetic,
  imageDims,
  directivesValue,
  promptDirectives,
  onDirectivesChange,
  operationMode,
  setOperationMode,
  promptStrength,
  setPromptStrength,
  guidanceScale,
  setGuidanceScale,
  seed,
  setSeed,
  handleInpaint,
  maskDataUrl,
  detectionArmed,
  armDetectionForCurrentBase,
  requestedConcept,
  conceptSegments,
  conceptLoading,
  displayedResult,
  handleConceptChange,
  handleConceptSubmit,
  conceptInputId,
  conceptInput,
  setConceptInput,
  conceptInputError,
  setConceptInputError,
  handleSelectAllDetected,
  handleClearSelection,
  detectedCount,
  selectionCount,
  selectAllNotice,
  setActiveTab,
  batchSelections,
  instanceLabels,
  activeBatch,
  handleBatchRun,
  handleBatchRetry,
  handleRemoveLastSelection,
  handleRemoveSelection,
  roomName,
  variantSlot,
  generatedVariations,
  selectedVariationId,
  setSelectedVariationId,
  isGeneratingVariations,
  variationProgress,
  setIsGeneratingVariations,
  setVariationProgress,
  activeResultUrl,
  setActiveResultUrl,
  generatedVariationsPanel,
  variantPanel,
  statusText,
  handleHolisticRun,
  showError,
  markRunCompletionRebase,
  onInpaintComplete,
}: EditorInspectorColumnProps) {
  return (
    <div
      data-inspector-column=""
      className={`no-print transition-all duration-300 ${
        inspectorView === "hidden"
          ? "zen-mode-hidden"
          : inspectorView === "rail"
            ? `w-full ${fullWidth ? "lg:w-12 lg:shrink-0" : ""}`
            : `flex w-full flex-col gap-3 ${fullWidth ? "lg:min-h-0 lg:w-[380px] lg:shrink-0" : ""}`
      }`}
    >
      {inspectorView === "rail" ? (
        <InspectorCollapsedRail onExpand={handleInspectorRailExpand} />
      ) : (
        <>
          {/* Issue #617: Active Inpaint Zone header with the collapse toggle.
              The five inspector sections live below: operation mode tabs +
              targeted prompt editor + AI guidance sliders (Manual paint tab,
              via #629/#558) and the generated variation grid (#630). */}
          <div
            id="inspector-panel-content"
            className="flex w-full min-h-0 flex-1 flex-col gap-3"
          >
            <InspectorHeader
              onToggleCollapse={inspectorPanel.toggle}
              isExpanded={inspectorView === "expanded"}
              activeBatch={activeBatch}
            />
            <CollapsibleSection
              id="brushPanel"
              title="Editor Controls"
              isCollapsed={brushPanel.isCollapsed}
              onToggle={brushPanel.toggle}
            >
              <div
                className={`flex flex-col gap-4 ${
                  fullWidth
                    ? "md:min-h-0 md:flex-1 md:overflow-visible lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                    : ""
                }`}
              >
                {sourceOptions.length > 1 && (
                  <SourceSelectorFieldset
                    roomId={roomId}
                    sourceOptions={sourceOptions}
                    source={source}
                    disabled={isProcessing}
                    onSelectSource={handleSourceChange}
                    canUndoSource={canUndoSource}
                    onUndoSource={handleUndoSource}
                  />
                )}

                <div className="sticky top-0 z-10 bg-atelier-canvas pb-1">
                  <div className="flex items-center justify-between">
                    <EditorTabBar
                      tabs={editorTabs}
                      activeTab={effectiveTab}
                      onSelectTab={handleTabSelect}
                      idBase={tabIdBase}
                    />
                    {saveStatus === "saving" || saveStatus === "dirty" ? (
                      <span className="text-xs text-muted-foreground animate-pulse">
                        Saving...
                      </span>
                    ) : saveStatus === "saved" ? (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        Saved
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Tab panels stay MOUNTED (hidden, not unmounted) so tab
                    switching performs zero state transitions — the batch
                    panel's prompts and mode survive round-trips (AC-L5). */}
                <EntireTabPanel
                  tabIdBase={tabIdBase}
                  hidden={effectiveTab !== "entire"}
                  roomId={roomId}
                  imageUrl={imageUrl}
                  aesthetic={aesthetic}
                  imageWidth={imageDims?.width ?? null}
                  imageHeight={imageDims?.height ?? null}
                  disabled={isProcessing || conceptLoading}
                  processing={isProcessing}
                  statusText={statusText}
                  onRun={handleHolisticRun}
                  onError={showError}
                />

                <ManualTabPanel
                  tabIdBase={tabIdBase}
                  hidden={effectiveTab !== "manual"}
                  roomId={roomId}
                  directivesValue={directivesValue}
                  promptDirectives={promptDirectives}
                  onDirectivesChange={onDirectivesChange}
                  operationMode={operationMode}
                  onOperationModeChange={setOperationMode}
                  promptStrength={promptStrength}
                  onPromptStrengthChange={setPromptStrength}
                  guidanceScale={guidanceScale}
                  onGuidanceScaleChange={setGuidanceScale}
                  seed={seed}
                  onSeedChange={setSeed}
                  onGenerate={handleInpaint}
                  isGenerating={isProcessing}
                  hasMask={!!maskDataUrl}
                />

                <DetectTabPanel
                  tabIdBase={tabIdBase}
                  hidden={effectiveTab !== "detect"}
                  imageUrl={imageUrl}
                  isProcessing={isProcessing}
                  detectionArmed={detectionArmed}
                  onArmDetection={armDetectionForCurrentBase}
                  requestedConcept={requestedConcept}
                  conceptLoading={conceptLoading}
                  conceptStatus={conceptSegments.status}
                  conceptFailedReason={conceptSegments.failedReason}
                  displayedResult={displayedResult}
                  onConceptChange={handleConceptChange}
                  onConceptSubmit={handleConceptSubmit}
                  conceptInputId={conceptInputId}
                  conceptInput={conceptInput}
                  onConceptInputChange={setConceptInput}
                  conceptInputError={conceptInputError}
                  onConceptInputErrorChange={setConceptInputError}
                  onSelectAllDetected={handleSelectAllDetected}
                  onClearSelection={handleClearSelection}
                  detectedCount={detectedCount}
                  selectionCount={selectionCount}
                  selectAllNotice={selectAllNotice}
                  onSwitchToManualTab={() => setActiveTab("manual")}
                  batchSelections={batchSelections}
                  instanceLabels={instanceLabels}
                  aesthetic={aesthetic}
                  activeBatch={activeBatch}
                  onBatchRun={handleBatchRun}
                  onBatchRetry={handleBatchRetry}
                  onRemoveLastSelection={handleRemoveLastSelection}
                  onRemoveSelection={handleRemoveSelection}
                />
              </div>
            </CollapsibleSection>

            <InspectorFooterPanels
              roomId={roomId}
              roomName={roomName}
              variantSlot={variantSlot}
              generatedVariations={generatedVariations}
              selectedVariationId={selectedVariationId}
              onSelectVariation={setSelectedVariationId}
              isGeneratingVariations={isGeneratingVariations}
              variationProgress={variationProgress}
              onGenerateMore={() => {
                // Issue #630: the parent is responsible for calling the inpaint
                // API multiple times to produce new variations and updating
                // generatedVariations / isGeneratingVariations / variationProgress.
                // Placeholder handler — replace with actual generation logic.
                setIsGeneratingVariations(true);
                setVariationProgress("Generating variation 1 of 4…");
              }}
              onUseVariation={(variation: { id: string; resultUrl: string }) => {
                // Issue #630: apply the selected variation's result URL to the
                // canvas — typically by calling onInpaintComplete or updating
                // the active result URL.
                setSelectedVariationId(variation.id);
                // Issue #748: applying a variation rebases the editor onto a
                // new base — land it lazy like any other completion rebase.
                markRunCompletionRebase();
                onInpaintComplete?.(variation.resultUrl, source);
              }}
              activeResultUrl={activeResultUrl}
              onActiveResultUrlChange={setActiveResultUrl}
              generatedVariationsPanel={generatedVariationsPanel}
              variantPanel={variantPanel}
            />
          </div>
        </>
      )}
    </div>
  );
}
