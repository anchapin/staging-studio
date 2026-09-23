"use client";

import { useState, useCallback, useMemo } from "react";
import { DEFAULT_MASK_EXPANSION_RADIUS } from "@/lib/mask-dilation";
import CollapsibleSection, {
  useCollapsiblePanel,
} from "./collapsible-section";
import EditorTabBar from "./editor-tab-bar";
import { type InpaintOperationModeId } from "./inpaint-operation-mode-tabs";
import { useToast, ToastContainer } from "@/components/ui/toast";

import InspectorCollapsedRail from "./inspector-collapsed-rail";
import {
  INSPECTOR_PANEL_STORAGE_KEY,
  resolveInspectorPanelView,
  resolveInspectorRailTarget,
  type InspectorRailActionId,
} from "@/lib/inspector-panel";
import { isOperationModeAvailable } from "@/lib/operation-mode-availability";
import FocusRestorePill from "./focus-restore-pill";
import EntireTabPanel from "./entire-tab-panel";
import ManualTabPanel from "./manual-tab-panel";
import DetectTabPanel from "./detect-tab-panel";
import EditorCanvasPane from "./editor-canvas-pane";
import InspectorHeader from "./inspector-header";
import ZenToolRail from "./zen-tool-rail";
import { useEditorTabs } from "./use-editor-tabs";
import { useImageDimensions } from "./use-image-dimensions";
import { useZenWorkspace } from "./use-zen-workspace";
import { useSourceSelection } from "./use-source-selection";
import { useConceptDetection } from "./use-concept-detection";
import { useWorkspaceShortcuts } from "./use-workspace-shortcuts";
import SourceSelectorFieldset from "./source-selector-fieldset";
import InspectorFooterPanels from "./inspector-footer-panels";
import { useSelectionMaskComposer } from "./use-selection-mask-composer";
import { useInpaintRuns } from "./use-inpaint-runs";
import { type GeneratedVariation } from "./generated-variation-grid";
import type { InpaintEditorProps } from "./inpaint-editor-props";
import VersionHistoryPills from "./version-history-pills";

export default function InpaintEditor({
  roomId,
  roomName,
  imageUrl,
  aesthetic,
  promptDirectives,
  globalDirectives = "",
  variantSlot,
  source,
  sourceOptions,
  onSourceChange,
  pendingRequestId,
  pendingSource,
  onInpaintComplete,
  onActiveConceptLabelChange,
  fullWidth = false,
  secondaryPane,
  onDirectivesChange,
  directivesValue,
  currentResultUrl,
  projectName,
}: InpaintEditorProps) {
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  // Natural-dimension tracking for the base photo (issue #691 hook).
  const { imageDims, aspectRatio } = useImageDimensions(imageUrl);
  // Issue #180: outward mask growth (in mask-canvas pixels) applied before
  // the mask is dispatched, so bezels/frames at the painted boundary are
  // regenerated too. 0 restores the un-dilated mask.
  const [maskExpansion, setMaskExpansion] = useState(DEFAULT_MASK_EXPANSION_RADIUS);
  // Issue #234: when enabled, dilate further downward than upward so floor
  // shadows cast by objects are swallowed by the regenerated region.
  const [includeFloorShadow, setIncludeFloorShadow] = useState(false);

  // Issue #558: AI guidance controls for inpaint runs
  const [promptStrength, setPromptStrength] = useState(0.8);
  // maskBlur, creativeMode, lockSeed: controlled by the new operation-mode tabs in issue #629.
  // The setters are unused (no UI for these in the Manual paint panel any more).
  const [maskBlur] = useState(5);
  const [creativeMode] = useState(false);
  const [lockSeed] = useState(false);
  const [seed, setSeed] = useState<number | undefined>(undefined);

  // Issue #629: Inpaint Operation Mode — secondary tab strip inside Manual paint panel.
  // Issue #692: only Inpaint Zone is wired; the other tabs render disabled with a
  // "Coming soon" badge (availability map lives in lib/operation-mode-availability).
  const [operationMode, setOperationMode] = useState<InpaintOperationModeId>("inpaint-zone");
  const [guidanceScale, setGuidanceScale] = useState(7.5);
  // Issue #460: comparison now via staged result image click in secondary pane
  const { toasts, showError, showSuccess, dismissToast } = useToast();

  // Issue #588: Collapsible workspace panels — persist collapsed state in localStorage.
  const brushPanel = useCollapsiblePanel("inpaint-editor:brushPanel", false);
  const promptPanel = useCollapsiblePanel("inpaint-editor:promptPanel", false);
  const variantPanel = useCollapsiblePanel("inpaint-editor:variantPanel", false);
  const generatedVariationsPanel = useCollapsiblePanel(
    "inpaint-editor:generatedVariations",
    false
  );

  // Issue #617: collapsible right inspector — the whole 380px panel
  // collapses to a 48px rail (persisted per the #588 pattern; expanded by
  // default). Zen/Focus modes hide the column entirely, so they override
  // (not clobber) this state — view resolution is pure, in
  // lib/inspector-panel.ts.
  const inspectorPanel = useCollapsiblePanel(INSPECTOR_PANEL_STORAGE_KEY, false);

  // Issue #630: Generated Variation Grid state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- placeholder: setGeneratedVariations will be called by the parent's variation generation logic
  const [generatedVariations, setGeneratedVariations] = useState<
    readonly GeneratedVariation[]
  >([]);
  const [selectedVariationId, setSelectedVariationId] = useState<string | null>(null);
  const [isGeneratingVariations, setIsGeneratingVariations] = useState(false);
  const [variationProgress, setVariationProgress] = useState("");

  // Issue #561: tracks the active result URL for the version history panel.
  // Updated on inpaint completion; also initialized from prop when provided.
  const [activeResultUrl, setActiveResultUrl] = useState<string | null>(currentResultUrl ?? null);

  // Issue #781: before/after comparison toggle — shows original when true, staged result when false
  const [showBefore, setShowBefore] = useState(true);

  // Concept detection + selection set (issue #691 extraction): the whole
  // #228/#229/#249/#252/#748 cluster — requested concept, refresh policy,
  // SegmentCache, decoded instances, vision labels, and the toggle/select
  // handlers — lives in use-concept-detection.ts.
  const concept = useConceptDetection({
    roomId,
    imageUrl,
    imageDims,
    showError,
    onActiveConceptLabelChange,
  });
  const {
    detectionArmed,
    requestedConcept,
    conceptSegments,
    conceptLoading,
    displayedResult,
    decodedInstances,
    conceptInput,
    setConceptInput,
    conceptInputError,
    setConceptInputError,
    conceptInputId,
    selectAllNotice,
    instanceLabels,
    batchSelections,
    setBatchSelections,
    setSelectedInstanceIndices,
    detectedCount,
    selectionCount,
    instanceOverlays,
    selectionMarkers,
    handleConceptChange,
    handleConceptSubmit,
    armDetectionForCurrentBase,
    handleRemoveLastSelection,
    handleRemoveSelection,
    handleClearSelection,
    handleMaskCleared,
    resetForUserSourceSwitch,
    markRunCompletionRebase,
  } = concept;

  // Zen/Focus workspace + brush tool rail state (issue #691 hook). The
  // Select Regions tool arms refresh detection for a lazy base (#748).
  const {
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
  } = useZenWorkspace(armDetectionForCurrentBase);

  const inspectorView = resolveInspectorPanelView({
    inspectorCollapsed: inspectorPanel.isCollapsed,
    focusMode,
    zenMode,
  });

  // Issue #203: selection-set union mask + canvas reset (composed by the
  // selection-mask composer, issue #691 extraction).
  const { unionMaskDataUrl, selectionReset, clearRegionMaskCache } =
    useSelectionMaskComposer({
      batchSelections,
      setBatchSelections,
      decodedInstances,
      imageDims,
    });

  // Inpaint runs (issue #691 extraction): status-hook wiring, the shared
  // submit path, and the per-object batch runner live in use-inpaint-runs.ts.
  // Issue #558 guidance memo: keeps the hook's callback identity stable
  // across renders that don't touch the guidance params.
  const runGuidance = useMemo(
    () => ({
      promptStrength,
      maskBlur,
      seed,
      creativeMode,
      lockSeed,
    }),
    [promptStrength, maskBlur, seed, creativeMode, lockSeed]
  );
  const {
    isProcessing,
    statusText,
    beginInpaintRun,
    handleBatchRun,
    handleBatchRetry,
    activeBatch,
  } = useInpaintRuns({
    roomId,
    variantSlot,
    imageUrl,
    aesthetic,
    promptDirectives,
    globalDirectives,
    source,
    pendingRequestId,
    pendingSource,
    guidance: runGuidance,
    showError,
    showSuccess,
    onInpaintComplete,
    setActiveResultUrl,
    markRunCompletionRebase,
    batchSelections,
    unionMaskDataUrl,
    setBatchSelections,
    setSelectedInstanceIndices,
  });

  // Issue #228 guards (run status lives here, the handlers in the concept
  // hook): toggles and bulk selects are ignored while a run is in flight.
  const conceptToggleInstance = concept.handleInstanceToggle;
  const conceptSelectAllDetected = concept.handleSelectAllDetected;
  const handleInstanceToggle = useCallback(
    (point: { x: number; y: number }) => {
      if (isProcessing) return;
      conceptToggleInstance(point);
    },
    [isProcessing, conceptToggleInstance]
  );

  const handleSelectAllDetected = useCallback(() => {
    if (isProcessing) return;
    conceptSelectAllDetected();
  }, [isProcessing, conceptSelectAllDetected]);

  // Issue #560/#588/#617/#638 workspace keyboard shortcuts (Z / Escape /
  // backtick / Cmd+B / F) — the listener lives in use-workspace-shortcuts.
  useWorkspaceShortcuts({
    zenMode,
    setZenMode,
    focusMode,
    setFocusMode,
    brushPanel,
    promptPanel,
    variantPanel,
    generatedVariationsPanel,
    inspectorPanel,
  });

  // "Edit from" source switching with undo (issue #691 hook).
  const { canUndoSource, handleSourceChange, handleUndoSource } =
    useSourceSelection({
      source,
      onSourceChange,
      clearMask: () => setMaskDataUrl(null),
      resetForUserSourceSwitch,
      clearRegionMaskCache,
    });

  const handleInpaint = useCallback(async () => {
    if (!promptDirectives.trim()) {
      showError(
        "Please fill in the “Manual paint directives” textarea in the right panel (or “Staging directives” in Room Details — they stay in sync)."
      );
      return;
    }

    if (!maskDataUrl) {
      showError("Please draw a mask on the image first.");
      return;
    }

    await beginInpaintRun({
      maskUrl: maskDataUrl,
      promptDirectives,
      globalDirectives,
      promptStrength,
      maskBlur,
      seed,
      creativeMode,
      lockSeed,
    });
  }, [maskDataUrl, promptDirectives, beginInpaintRun, showError, globalDirectives, promptStrength, maskBlur, seed, creativeMode, lockSeed]);

  // Holistic spike entry (issue #190): the panel builds the full-room
  // mask + aesthetic-derived directives; this just forwards them into
  // the shared run launcher. The one-click preset (issue #191) reuses
  // the same shape and launcher.
  const handleHolisticRun = useCallback(
    (run: { maskDataUrl: string; promptDirectives: string; negativePrompt: string }) => {
      void beginInpaintRun({
        maskUrl: run.maskDataUrl,
        promptDirectives: run.promptDirectives,
        negativePrompt: run.negativePrompt,
        // Issue #558: pass AI guidance settings
        promptStrength,
        maskBlur,
        seed,
        creativeMode,
        lockSeed,
      });
    },
    [beginInpaintRun, promptStrength, maskBlur, seed, creativeMode, lockSeed]
  );

  // Issue #252 D5: control-panel tab state (issue #691 hook) — purely
  // presentational, so switching never touches staging state (AC-L5).
  const {
    setActiveTab,
    tabIdBase,
    editorTabs,
    effectiveTab,
    handleTabSelect,
  } = useEditorTabs({
    source,
    hasPaintedMask: Boolean(maskDataUrl),
    selectionCount,
    onSelectDetectTab: armDetectionForCurrentBase,
  });

  // Issue #617: rail buttons re-expand the inspector and navigate to the
  // matching section (prompt editor / AI variations / relight). Targets
  // are pure, from resolveInspectorRailTarget.
  const handleInspectorRailExpand = useCallback(
    (actionId: InspectorRailActionId) => {
      const target = resolveInspectorRailTarget(actionId);
      inspectorPanel.setIsCollapsed(false);
      handleTabSelect(target.tab);
      // Issue #692: only switch to modes with a shipped backend — the
      // Relight rail action still expands the inspector and lands on the
      // Manual paint tab, but never activates a disabled mode.
      if (
        target.operationMode &&
        isOperationModeAvailable(target.operationMode)
      ) {
        setOperationMode(target.operationMode);
      }
    },
    [inspectorPanel, handleTabSelect]
  );

  return (
    /* Issue #252 D5: laptop-first two-pane layout — mask canvas LEFT
       sized to the remaining viewport, fixed-width control panel RIGHT;
       both panes scroll internally so page-level scrolling dies at laptop
       size (AC-L1/L2). Below lg the same tabs stack in one column
       (AC-L6). At md (768px-1023px) the layout stacks vertically to
       prevent horizontal overflow on tablet screens (issue #317). */
    <div
      className={`flex flex-col gap-6 ${
        fullWidth ? "md:flex-col lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-6" : ""
      } ${zenMode ? "zen-mode-active zen-mode-vignette" : ""} ${focusMode ? "zen-mode-active zen-mode-vignette" : ""} ${zenDarkBackground && zenMode ? "zen-mode-dark" : ""}`}
    >
      {/* Issue #638: Floating restore pill — shown at top-center when Focus Canvas Mode is active */}
      {focusMode && (
        <FocusRestorePill
          projectName={projectName}
          roomName={roomName}
          onRestore={() => setFocusMode(false)}
        />
      )}
      {/* ---- LEFT PANE: room imagery (optional slot) + mask canvas ------ */}
      <EditorCanvasPane
        fullWidth={fullWidth}
        secondaryPane={secondaryPane}
        promptPanel={promptPanel}
        zenMode={zenMode}
        focusMode={focusMode}
        onToggleFocusMode={() => setFocusMode((prev) => !prev)}
        onToggleZenMode={() => setZenMode((prev) => !prev)}
        showBefore={showBefore}
        onToggleShowBefore={() => setShowBefore((prev) => !prev)}
        imageUrl={imageUrl}
        activeResultUrl={activeResultUrl}
        aspectRatio={aspectRatio}
        naturalWidth={imageDims?.width ?? null}
        naturalHeight={imageDims?.height ?? null}
        initialMaskDataUrl={maskDataUrl}
        onMaskChange={setMaskDataUrl}
        onInstanceToggle={handleInstanceToggle}
        segmentDisabled={isProcessing || conceptLoading}
        processing={isProcessing}
        segmenting={conceptLoading}
        detectingConcept={conceptLoading ? requestedConcept : undefined}
        instanceOverlays={instanceOverlays}
        selectionMarkers={selectionMarkers}
        expansionRadius={maskExpansion}
        includeFloorShadow={includeFloorShadow}
        selectionReset={selectionReset}
        onMaskCleared={handleMaskCleared}
        onSelectionDeselect={handleRemoveSelection}
        onSelectRegionsActivate={armDetectionForCurrentBase}
        zenBrushSize={zenBrushSize}
        onZenBrushSizeChange={setZenBrushSize}
        zenActiveTool={zenActiveTool}
        onZenActiveToolChange={setZenActiveTool}
        maskExpansion={maskExpansion}
        onMaskExpansionChange={setMaskExpansion}
        onIncludeFloorShadowChange={setIncludeFloorShadow}
      />

      {/* Issue #617: collapsible right inspector — the 380px panel and the
          48px rail share this column; `transition-all duration-300` on the
          column animates the width between them.
          Issue #560: right panel hidden in Zen Mode.
          Issue #638: right panel hidden in Focus Canvas Mode (the restore
          pill owns the way back — no rail in either mode). */}
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
              fullWidth ? "md:min-h-0 md:flex-1 md:overflow-visible lg:min-h-0 lg:flex-1 lg:overflow-y-auto" : ""
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
            <EditorTabBar
              tabs={editorTabs}
              activeTab={effectiveTab}
              onSelectTab={handleTabSelect}
              idBase={tabIdBase}
            />
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
          onUseVariation={(variation) => {
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

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Issue #616: Floating glassmorphic canvas tool rail — left-anchored
          stack (1.5rem from viewport edges) with the tool strip, brush
          parameter flyout, and zoom HUD. Shown when Zen Mode is active. */}
      {zenMode && (
        <ZenToolRail
          studioActiveTool={studioActiveTool}
          onStudioToolChange={handleStudioToolChange}
          brushRadius={brushRadius}
          onBrushRadiusChange={setBrushRadius}
          brushEdgeSoftness={brushEdgeSoftness}
          onBrushEdgeSoftnessChange={setBrushEdgeSoftness}
          brushMaskOpacity={brushMaskOpacity}
          onBrushMaskOpacityChange={setBrushMaskOpacity}
          onCloseFlyout={() => setStudioActiveTool("select")}
        />
      )}

      {/* Issue #631: Version History Pills — floating bar at bottom-center of canvas
          showing pass/version history with undo/redo controls. */}
      <VersionHistoryPills
        roomId={roomId}
        variantSlot={variantSlot}
        activeResultUrl={activeResultUrl}
        onVersionChange={(resultUrl) => {
          setActiveResultUrl(resultUrl);
        }}
      />
    </div>
  );
}

