"use client";

import { useState, useCallback, useEffect, useRef, useMemo, useId } from "react";
import type { ReactNode } from "react";
import InpaintMaskCanvas, { type MaskTool } from "./inpaint-mask-canvas";
import { DEFAULT_MASK_EXPANSION_RADIUS } from "@/lib/mask-dilation";
import CollapsibleSection, {
  useCollapsiblePanel,
} from "./collapsible-section";
import EditorTabBar, {
  type EditorTab,
  type EditorTabId,
} from "./editor-tab-bar";
import { type InpaintOperationModeId } from "./inpaint-operation-mode-tabs";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { Loader2, PanelRightClose } from "lucide-react";

import BrushToolRail, {
  BrushParameterFlyout,
  CanvasZoomHud,
  type StudioTool,
} from "./BrushToolRail";
import InspectorCollapsedRail from "./inspector-collapsed-rail";
import {
  INSPECTOR_PANEL_STORAGE_KEY,
  resolveInspectorPanelView,
  resolveInspectorRailTarget,
  resolveInspectorShortcut,
  type InspectorRailActionId,
} from "@/lib/inspector-panel";
import {
  entireRoomTabVisible,
  inpaintSourceLabel,
  inpaintSourcesEqual,
  type InpaintSource,
} from "@/lib/inpaint-source";
import { isOperationModeAvailable } from "@/lib/operation-mode-availability";
import FocusRestorePill from "./focus-restore-pill";
import SourceImageHeader from "./source-image-header";
import MaskDilationControls from "./mask-dilation-controls";
import EntireTabPanel from "./entire-tab-panel";
import ManualTabPanel from "./manual-tab-panel";
import DetectTabPanel from "./detect-tab-panel";
import { useConceptDetection } from "./use-concept-detection";
import { useSelectionMaskComposer } from "./use-selection-mask-composer";
import { useInpaintRuns } from "./use-inpaint-runs";
import { batchProgressText, hasFailedStep } from "@/lib/multi-select-batch";
import VersionHistoryPanel from "./version-history-panel";
import GeneratedVariationGrid, {
  type GeneratedVariation,
} from "./generated-variation-grid";
import VersionHistoryPills from "./version-history-pills";

interface InpaintEditorProps {
  roomId: string;
  /** The resolved source image the mask applies to (before photo or staged variant). */
  imageUrl: string;
  aesthetic: string;
  /** Room-specific staging directives (displayed in textarea, merged with global for AI). */
  promptDirectives: string;
  /** Issue #562: Global project-level directives merged with room directives for AI. */
  globalDirectives?: string;
  /** The "after" slot this run's result will land in (resolved by the parent). */
  variantSlot: 0 | 1;
  /** Currently selected source; the parent owns this state (issue #170). */
  source: InpaintSource;
  /** Available source options (original photo + staged variants). */
  sourceOptions: InpaintSource[];
  onSourceChange?: (source: InpaintSource) => void;
  pendingRequestId?: string | null;
  /** Source of the pending run, reconstructed from its persisted row. */
  pendingSource?: InpaintSource | null;
  onInpaintComplete?: (resultImageUrl: string, source: InpaintSource) => void;
  /**
   * Issue #561: the current "after" result URL for the variant slot being edited.
   * Used to highlight the active version in the VersionHistoryPanel.
   */
  currentResultUrl?: string | null;
  /**
   * Issue #230: reports the active labeled concept selection — the label
   * when exactly one labeled selection is active, null otherwise. The
   * parent uses it to pre-fill the single-object staging directives
   * ("Replace the {concept} with ") without ever clobbering typed text.
   */
  onActiveConceptLabelChange?: (label: string | null) => void;
  /**
   * Full-width focused layout (issue #169): the mask canvas spans the
   * available content width instead of the compact card cap.
   */
  fullWidth?: boolean;
  /**
   * Issue #252 D5: content rendered above the mask canvas in the left
   * pane (the focused page's room imagery, variant strip, and directives
   * sections). At lg+ this area is height-capped and scrolls internally
   * so the canvas and the control panel stay in view without page-level
   * scrolling.
   */
  secondaryPane?: ReactNode;
  /**
   * Issue #507: callback to update staging directives from within the
   * editor's inline textarea (kept in sync with the parent's copy).
   */
  onDirectivesChange?: (value: string) => void;
  /** Current directives value for the inline textarea. */
  directivesValue?: string;
  /** Issue #638: Project name for Focus Canvas Mode breadcrumb. */
  projectName?: string;
  /** Issue #638: Room name for Focus Canvas Mode breadcrumb. */
  roomName?: string;
}

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
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
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

  // Issue #560: Zen Mode state — hides all chrome for a distraction-free workspace.
  const [zenMode, setZenMode] = useState(false);
  // Issue #560: dark background toggle for eye comfort in Zen Mode.
  const [zenDarkBackground] = useState(false);

  // Issue #638: Focus Canvas Mode state — collapses header and inspector simultaneously.
  const [focusMode, setFocusMode] = useState(false);

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
  const inspectorView = resolveInspectorPanelView({
    inspectorCollapsed: inspectorPanel.isCollapsed,
    focusMode,
    zenMode,
  });

  // Issue #630: Generated Variation Grid state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- placeholder: setGeneratedVariations will be called by the parent's variation generation logic
  const [generatedVariations, setGeneratedVariations] = useState<
    readonly GeneratedVariation[]
  >([]);
  const [selectedVariationId, setSelectedVariationId] = useState<string | null>(null);
  const [isGeneratingVariations, setIsGeneratingVariations] = useState(false);
  const [variationProgress, setVariationProgress] = useState("");

  // Issue #560: lifted brush state — shared between InpaintMaskCanvas and ZenModeToolbar.
  const [zenBrushSize, setZenBrushSize] = useState(20);
  const [zenActiveTool, setZenActiveTool] = useState<MaskTool>("brush");

  // Issue #627: Brush Tool Rail state — lifted state for the full tool rail + parameter flyout.
  const [studioActiveTool, setStudioActiveTool] = useState<StudioTool>("brush");
  const [brushRadius, setBrushRadius] = useState(42);
  const [brushEdgeSoftness, setBrushEdgeSoftness] = useState(35);
  const [brushMaskOpacity, setBrushMaskOpacity] = useState(80);

  // Issue #561: tracks the active result URL for the version history panel.
  // Updated on inpaint completion; also initialized from prop when provided.
  const [activeResultUrl, setActiveResultUrl] = useState<string | null>(currentResultUrl ?? null);

  // Issue #378: source change undo state
  const previousSourceRef = useRef<InpaintSource | null>(null);
  const [canUndoSource, setCanUndoSource] = useState(false);

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
  const handleTabSelect = useCallback(
    (tab: EditorTabId) => {
      setActiveTab(tab);
      if (tab === "detect") armDetectionForCurrentBase();
    },
    [armDetectionForCurrentBase]
  );

  const handleStudioToolChange = useCallback(
    (tool: StudioTool) => {
      setStudioActiveTool(tool);
      if (tool === "select") armDetectionForCurrentBase();
    },
    [armDetectionForCurrentBase]
  );

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

  // and export masks at the photo's exact pixel dimensions.
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImageDims({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = imageUrl;
    return () => {
      img.onload = null;
    };
  }, [imageUrl]);

  const aspectRatio = imageDims ? imageDims.width / imageDims.height : null;

  // Issue #560: keyboard shortcuts for Zen Mode — Z toggles, Escape exits.
  // Issue #638: keyboard shortcut for Focus Canvas Mode — F toggles, Escape exits.
  // Issue #588: backtick (`) toggles all collapsible panels.
  // Issue #617: Cmd/Ctrl+B toggles the right inspector panel; F is classified
  // by the same resolver so modifier combos (Cmd/Ctrl+F stays browser Find)
  // never trigger Focus Canvas Mode.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "z" || e.key === "Z") {
        if (!isInput) {
          e.preventDefault();
          setZenMode((prev) => !prev);
        }
      }

      // Issue #617/#638: inspector + focus-mode shortcut resolution
      // (pure, pinned by tests/inspector-panel.test.ts).
      const shortcut = resolveInspectorShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        isTextEntry: isInput,
      });
      if (shortcut === "toggle-inspector") {
        e.preventDefault();
        inspectorPanel.toggle();
      }
      if (shortcut === "toggle-focus-mode") {
        e.preventDefault();
        setFocusMode((prev) => !prev);
      }

      if (e.key === "Escape" && (zenMode || focusMode)) {
        e.preventDefault();
        setZenMode(false);
        setFocusMode(false);
      }

      // Issue #588: backtick toggles all workspace panels
      if (e.key === "`" && !isInput) {
        e.preventDefault();
        const allCollapsed =
          brushPanel.isCollapsed && promptPanel.isCollapsed && variantPanel.isCollapsed && generatedVariationsPanel.isCollapsed;
        if (allCollapsed) {
          brushPanel.setIsCollapsed(false);
          promptPanel.setIsCollapsed(false);
          variantPanel.setIsCollapsed(false);
          generatedVariationsPanel.setIsCollapsed(false);
        } else {
          brushPanel.setIsCollapsed(true);
          promptPanel.setIsCollapsed(true);
          variantPanel.setIsCollapsed(true);
          generatedVariationsPanel.setIsCollapsed(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zenMode, focusMode, brushPanel, promptPanel, variantPanel, generatedVariationsPanel, inspectorPanel]);

  // Switching source swaps the image being edited — any existing mask was
  // drawn for the previous image and must not leak into the next run. The
  // segment cache is dropped with it (issue #202/#228 lifecycle: one
  // session per image), and the concept session resets to the default.
  const handleSourceChange = useCallback(
    (next: InpaintSource) => {
      if (inpaintSourcesEqual(next, source)) return;
      // Issue #378: save current source for undo before switching
      previousSourceRef.current = source;
      setCanUndoSource(true);
      setMaskDataUrl(null);
      // Issue #203: masks (and the selection set that produced them) were
      // segmented against the previous image — they must not leak. The
      // union/reset state follows the selection set via effects. The
      // detection/selection session reset (incl. the #748 user-switch
      // arming) lives in the concept hook.
      resetForUserSourceSwitch();
      clearRegionMaskCache();
      onSourceChange?.(next);
    },
    [source, onSourceChange, resetForUserSourceSwitch, clearRegionMaskCache]
  );

  // Issue #378: undo source change by restoring the previous source
  const handleUndoSource = useCallback(() => {
    if (!previousSourceRef.current) return;
    const prev = previousSourceRef.current;
    // Restore the previous source by calling handleSourceChange with the previous source
    // This will trigger the full reset logic that handleSourceChange does
    previousSourceRef.current = source;
    setMaskDataUrl(null);
    // Undo is a user-driven source switch — same session reset, then arm
    // the restored base (issue #748).
    resetForUserSourceSwitch();
    clearRegionMaskCache();
    onSourceChange?.(prev);
  }, [source, onSourceChange, resetForUserSourceSwitch, clearRegionMaskCache]);

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

  // Issue #252 D5: control-panel tab state — purely presentational, so
  // switching never touches staging state (AC-L5). The default is the
  // Auto detect tab.
  const [activeTab, setActiveTab] = useState<EditorTabId>("detect");
  const tabIdBase = useId();
  // AC-L4: tab availability is a pure function of the displayed base
  // image — Entire room only over the original photo. Derived in render
  // (zero effects): over a variant the tab disappears and the panel lands
  // on Manual; switching back brings Entire room (and its active state)
  // straight back.
  const showEntireRoomTab = entireRoomTabVisible(source);
  const effectiveTab =
    activeTab === "entire" && !showEntireRoomTab ? "manual" : activeTab;
  const editorTabs: EditorTab[] = [
    ...(showEntireRoomTab
      ? [{ id: "entire" as const, label: "Entire room" }]
      : []),
    {
      id: "manual",
      label: "Manual paint",
      // Un-run work badge (AC-L5): a painted-but-unapplied mask.
      badge: maskDataUrl ? true : undefined,
    },
    ...[
      {
        id: "detect" as const,
        label: "Auto detect",
        // Un-run work badge: pending region selections.
        badge: selectionCount > 0 ? selectionCount : undefined,
      },
    ],
  ];

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
          onToggleFocusMode={() => setFocusMode((prev) => !prev)}
          onToggleZenMode={() => setZenMode((prev) => !prev)}
        />
        {/* Issue #460: comparison now via staged result image click in secondary pane */}
        <InpaintMaskCanvas
          overlayImageSrc={imageUrl}
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
          fullWidth={fullWidth}
          selectionReset={selectionReset}
          onMaskCleared={handleMaskCleared}
          onSelectionDeselect={handleRemoveSelection}
          zenMode={zenMode}
          brushSize={zenMode ? zenBrushSize : undefined}
          onBrushSizeChange={zenMode ? setZenBrushSize : undefined}
          activeTool={zenMode ? zenActiveTool : undefined}
          onActiveToolChange={zenMode ? setZenActiveTool : undefined}
          onSelectRegionsActivate={armDetectionForCurrentBase}
        />

        {/* Issue #560: expand selection and floor shadow controls hidden in Zen Mode */}
        {/* Issue #638: hidden in Focus Canvas Mode */}
        <MaskDilationControls
          hidden={zenMode || focusMode}
          maskExpansion={maskExpansion}
          onMaskExpansionChange={setMaskExpansion}
          includeFloorShadow={includeFloorShadow}
          onIncludeFloorShadowChange={setIncludeFloorShadow}
        />
      </div>

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
          <div className="flex shrink-0 items-center justify-between rounded-md border border-atelier-taupe/30 bg-white px-3 py-2">
            <h3 className="font-jakarta text-sm font-semibold text-atelier-primary">
              Active Inpaint Zone
            </h3>
            <button
              type="button"
              onClick={inspectorPanel.toggle}
              title="Collapse inspector (Cmd+B)"
              aria-label="Collapse inspector (Cmd+B)"
              aria-expanded={inspectorView === "expanded"}
              aria-controls="inspector-panel-content"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-atelier-taupe/40 bg-white text-atelier-taupe shadow-sm transition-colors hover:bg-atelier-canvas hover:text-atelier-primary"
            >
              <PanelRightClose className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        {/* AC-L2: batch progress pins to the panel top during a run, so
            it stays visible beside the canvas on every tab. The full
            progress + retry affordance stays in the batch panel. */}
        {activeBatch && (
          <div
            role="status"
            className="flex shrink-0 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"
          >
            {!hasFailedStep(activeBatch.progress) && (
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
              />
            )}
            {batchProgressText(activeBatch.progress) ??
              "Batch staging in progress…"}
          </div>
        )}
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
            <fieldset className="shrink-0 rounded-md border border-atelier-taupe/30 p-3">
              <legend className="px-1 font-jakarta text-sm font-medium text-atelier-primary">
                Edit from
              </legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {sourceOptions.map((option) => (
                  <label
                    key={inpaintSourceLabel(option)}
                    className="inline-flex cursor-pointer items-center gap-2 font-jakarta text-sm text-atelier-primary"
                  >
                    <input
                      type="radio"
                      name={`inpaint-source-${roomId}`}
                      value={inpaintSourceLabel(option)}
                      checked={inpaintSourcesEqual(option, source)}
                      disabled={isProcessing}
                      onChange={() => handleSourceChange(option)}
                      className="h-4 w-4 accent-atelier-primary"
                    />
                    {inpaintSourceLabel(option)}
                  </label>
                ))}
              </div>
              {canUndoSource && (
                <button
                  type="button"
                  onClick={handleUndoSource}
                  className="mt-2 text-xs text-atelier-taupe underline hover:text-atelier-primary"
                >
                  Undo source change
                </button>
              )}
            </fieldset>
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
            onSelect={setSelectedVariationId}
            onGenerateMore={() => {
              // Issue #630: the parent is responsible for calling the inpaint
              // API multiple times to produce new variations and updating
              // generatedVariations / isGeneratingVariations / variationProgress.
              // Placeholder handler — replace with actual generation logic.
              setIsGeneratingVariations(true);
              setVariationProgress("Generating variation 1 of 4…");
            }}
            onUse={(variation) => {
              // Issue #630: apply the selected variation's result URL to the
              // canvas — typically by calling onInpaintComplete or updating
              // the active result URL.
              setSelectedVariationId(variation.id);
              // Issue #748: applying a variation rebases the editor onto a
              // new base — land it lazy like any other completion rebase.
              markRunCompletionRebase();
              onInpaintComplete?.(variation.resultUrl, source);
            }}
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
            onRestored={(resultUrl) => {
              setActiveResultUrl(resultUrl);
            }}
          />
        </CollapsibleSection>
        </div>
          </>
        )}
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Issue #616: Floating glassmorphic canvas tool rail — left-anchored
          stack (1.5rem from viewport edges) with the tool strip, brush
          parameter flyout, and zoom HUD. Shown when Zen Mode is active. */}
      {zenMode && (
        <div className="fixed left-6 top-6 z-50 flex flex-col items-start gap-3">
          <BrushToolRail
            activeTool={studioActiveTool}
            onToolChange={handleStudioToolChange}
          />
          {studioActiveTool === "brush" && (
            <BrushParameterFlyout
              radius={brushRadius}
              edgeSoftness={brushEdgeSoftness}
              maskOpacity={brushMaskOpacity}
              onRadiusChange={setBrushRadius}
              onEdgeSoftnessChange={setBrushEdgeSoftness}
              onMaskOpacityChange={setBrushMaskOpacity}
              onClose={() => setStudioActiveTool("select")}
            />
          )}
          <CanvasZoomHud />
        </div>
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

