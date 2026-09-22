"use client";

import { useState, useCallback, useEffect, useRef, useMemo, useId } from "react";
import type { ReactNode } from "react";
import InpaintMaskCanvas, { type MaskTool } from "./inpaint-mask-canvas";
import EditorTabBar, {
  editorTabId,
  editorTabPanelId,
  type EditorTab,
  type EditorTabId,
} from "./editor-tab-bar";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { ChevronDown, ChevronUp, Info, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { useInpaintStatus } from "./use-inpaint-status";
import ZenModeToolbar from "./zen-mode-toolbar";
import {
  entireRoomTabVisible,
  inpaintSourceLabel,
  inpaintSourcesEqual,
  type InpaintSource,
} from "@/lib/inpaint-source";
import {
  DEFAULT_MASK_EXPANSION_RADIUS,
  MAX_MASK_EXPANSION_RADIUS,
} from "@/lib/mask-dilation";
import StageEntireRoomPreset from "./stage-entire-room-preset";
import BatchStagingPanel from "./batch-staging-panel";
import { useConceptSegments } from "./use-segment-prewarm";
import { SegmentCache, type SegmentCacheEntry } from "@/lib/segment-cache";
import {
  buildConceptEmptyMessage,
  buildSelectionLoggedEvent,
  CONCEPT_CHIPS,
  CONCEPT_EVENT_LOG_PREFIX,
  DEFAULT_CONCEPT,
  isValidConceptName,
  normalizeConceptInput,
} from "@/lib/concept-chips";
import { findInstanceAtPoint, instanceSeedPoint } from "@/lib/instance-hit-test";
import { logSelectionEvent } from "@/app/actions/selection-log";
import {
  maskGridFromProviderPixels,
  paintMaskPixels,
} from "@/lib/mask-format";
import { maskGridFromPixels } from "@/lib/mask-flood-fill";
import { computeMaskCanvasDimensions } from "@/lib/canvas-coords";
import { fillHoles, closeRegion, MERGE_PROXIMITY_PX } from "@/lib/mask-postprocess";
import { maskBounds, topmostLeftmostPoint } from "@/lib/vision-labels";
import { type DeclutterIntensity } from "@/lib/holistic-prompt";
import {
  MAX_BATCH_OBJECTS,
  advanceBatchProgress,
  applyConceptSelectAll,
  applyConceptToggle,
  batchProgressText,
  buildBatchPlan,
  hasFailedStep,
  initialBatchProgress,
  reduceSelectionSet,
  unionMaskBuffers,
  type BatchProgress,
  type BatchPromptMode,
  type BatchSelection,
  type ConceptSelectAllCandidate,
  type InstanceMaskGrid,
  type PerObjectBatchPlan,
} from "@/lib/multi-select-batch";
import VersionHistoryPanel, {
  generateThumbnailFromUrl,
} from "./version-history-panel";
import { saveInpaintVersion } from "@/app/actions/inpaint-versions";

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
}

/** Resolves when the image is loaded; rejects on a load error. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load."));
    img.src = src;
  });
}

/**
 * OR-composes every selection's mask into one union-mask data URL (issue
 * #203 thematic mode). Decodes each mask at natural dimensions, runs the
 * pure `unionMaskBuffers` composition, and serializes the result.
 * Browser-only.
 */
async function composeUnionMaskDataUrl(
  maskDataUrls: string[],
  width: number,
  height: number
): Promise<string | null> {
  if (maskDataUrls.length === 0) return null;
  const buffers = await decodeMaskBuffers(maskDataUrls, width, height);
  if (!buffers) return null;
  const union = unionMaskBuffers(buffers);
  if (!union) return null;

  // Issue #252 D3: hole-fill the union at composition (filling runs last —
  // unioning region masks can seal new enclosed pockets), so the thematic
  // run never receives a donut.
  const unionGrid = maskGridFromPixels(union.data, union.width, union.height);
  const filledUnion = fillHoles(unionGrid, union.width, union.height);
  if (filledUnion) {
    const unionData = union.data;
    for (let i = 0; i < filledUnion.mask.length; i++) {
      const o = i * 4;
      if (filledUnion.mask[i] === 1) {
        unionData[o] = 255;
        unionData[o + 1] = 255;
        unionData[o + 2] = 255;
      }
      unionData[o + 3] = 255;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(union.data), union.width, union.height),
    0,
    0
  );
  return canvas.toDataURL("image/png");
}

/**
 * Rasterizes one instance crop from the displayed source image for the
 * batched vision-labeling call (issue #252 D4): crops the instance's
 * bounding box (plus 4% context padding) at the photo's natural
 * dimensions, downscales the long edge to 320px to keep the vision
 * request cheap, and serializes as JPEG. Null when the image or crop
 * fails. Browser-only.
 */
async function cropInstanceDataUrl(
  sourceImg: HTMLImageElement,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  naturalDims: { width: number; height: number }
): Promise<string | null> {
  const padX = Math.round((bounds.maxX - bounds.minX + 1) * 0.04);
  const padY = Math.round((bounds.maxY - bounds.minY + 1) * 0.04);
  const cropX = Math.max(0, bounds.minX - padX);
  const cropY = Math.max(0, bounds.minY - padY);
  const cropW = Math.min(naturalDims.width, bounds.maxX + 1 + padX) - cropX;
  const cropH = Math.min(naturalDims.height, bounds.maxY + 1 + padY) - cropY;
  if (cropW <= 0 || cropH <= 0) return null;

  const long = Math.max(cropW, cropH);
  const scale = long > 320 ? 320 / long : 1;
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(sourceImg, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
  try {
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

/** Decodes mask data URLs into RGBA buffers at one shared geometry. Browser-only. */
async function decodeMaskBuffers(
  maskDataUrls: string[],
  width: number,
  height: number
): Promise<Array<{ width: number; height: number; data: Uint8ClampedArray }> | null> {
  const buffers: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [];
  for (const url of maskDataUrls) {
    try {
      const img = await loadImage(url);
      const layer = document.createElement("canvas");
      layer.width = width;
      layer.height = height;
      const layerCtx = layer.getContext("2d");
      if (!layerCtx) return null;
      layerCtx.drawImage(img, 0, 0, width, height);
      buffers.push({
        width,
        height,
        data: layerCtx.getImageData(0, 0, width, height).data,
      });
    } catch {
      return null;
    }
  }
  return buffers;
}

/**
 * Composes one merged region's mask (issue #252 D2/D3): union the member
 * masks, morphologically close with the proximity radius scaled to natural
 * dimensions (bridges the seam between fused objects), then fill holes
 * (closing can seal new pockets; filling runs last). Browser-only.
 */
async function composeRegionMaskDataUrl(
  maskDataUrls: string[],
  width: number,
  height: number,
  closeRadius: number
): Promise<string | null> {
  if (maskDataUrls.length === 0) return null;
  const buffers = await decodeMaskBuffers(maskDataUrls, width, height);
  if (!buffers) return null;
  const union = unionMaskBuffers(buffers);
  if (!union) return null;

  const unionGrid = maskGridFromPixels(union.data, union.width, union.height);
  const closed = closeRegion(unionGrid, width, height, closeRadius);
  const closedGrid = closed ? closed.mask : unionGrid;
  const filled = fillHoles(closedGrid, width, height);
  const finalGrid = filled ? filled.mask : closedGrid;

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < finalGrid.length; i++) {
    const o = i * 4;
    if (finalGrid[i] === 1) {
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
    }
    data[o + 3] = 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(data, width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

// -------------------------------------------------------------------------
// Issue #228: SAM 3.1 concept-instance decoding. The detection route
// returns per-instance masks whose provider format varies — live captures
// (issue #248) show grayscale white-on-black PNGs with NO alpha channel,
// while #228 assumed alpha cutouts — so grid extraction goes through the
// format-agnostic classifier and the toggle path rebuilds each mask as
// white-on-black from that classification (the same derived-alpha
// technique every SAM-mask consumer now shares).
// -------------------------------------------------------------------------

/** One decoded detection instance, in response order (score-ranked). */
interface DecodedInstance {
  grid: Uint8Array;
  width: number;
  height: number;
  /** Provider confidence, or null when the response omitted it. */
  score: number | null;
  /** White-on-black mask at the photo's natural dimensions (toggle path). */
  whiteMaskDataUrl: string;
}

/**
 * Decodes one provider mask (grayscale or alpha-cutout — the classifier
 * detects the format) into a hit-test grid (at `gridDims`, the
 * mask-canvas resolution — click points arrive in that space) plus a
 * white-on-black data URL at the photo's natural dimensions. Returns
 * null when the image fails to decode; the caller preserves the slot so
 * response indices stay stable. Browser-only.
 */
async function decodeConceptInstance(
  maskDataUrl: string,
  score: number | null,
  gridDims: { width: number; height: number },
  naturalDims: { width: number; height: number }
): Promise<DecodedInstance | null> {
  try {
    const img = await loadImage(maskDataUrl);

    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = gridDims.width;
    gridCanvas.height = gridDims.height;
    const gridCtx = gridCanvas.getContext("2d");
    if (!gridCtx) return null;
    gridCtx.drawImage(img, 0, 0, gridDims.width, gridDims.height);
    const gridPixels = gridCtx.getImageData(0, 0, gridDims.width, gridDims.height);

    const whiteCanvas = document.createElement("canvas");
    whiteCanvas.width = naturalDims.width;
    whiteCanvas.height = naturalDims.height;
    const whiteCtx = whiteCanvas.getContext("2d");
    if (!whiteCtx) return null;
    whiteCtx.drawImage(img, 0, 0, naturalDims.width, naturalDims.height);
    const painted = paintMaskPixels(
      whiteCtx.getImageData(0, 0, naturalDims.width, naturalDims.height).data,
      naturalDims.width,
      naturalDims.height,
      { maskedColor: [255, 255, 255] }
    );

    // Issue #252 D3: hole-fill the region mask at composition time so the
    // canvas tint and the dispatched mask are identical and donut-free
    // (WYSIWYG). The natural-resolution mask is re-classified from the
    // painted buffer (white-on-black is stable through the classifier),
    // hole-filled, and written back as pure white/black pixels.
    const naturalGrid = maskGridFromProviderPixels(
      painted,
      naturalDims.width,
      naturalDims.height
    );
    const filledNatural = fillHoles(naturalGrid, naturalDims.width, naturalDims.height);
    if (filledNatural && filledNatural.filledCount > 0) {
      for (let i = 0; i < filledNatural.mask.length; i++) {
        const o = i * 4;
        if (filledNatural.mask[i] === 1) {
          painted[o] = 255;
          painted[o + 1] = 255;
          painted[o + 2] = 255;
          painted[o + 3] = 255;
        } else {
          painted[o] = 0;
          painted[o + 1] = 0;
          painted[o + 2] = 0;
          painted[o + 3] = 255;
        }
      }
    }
    whiteCtx.putImageData(
      new ImageData(new Uint8ClampedArray(painted), naturalDims.width, naturalDims.height),
      0,
      0
    );

    // Same invariant for the hit-test grid the toggle path reasons about.
    let grid = maskGridFromProviderPixels(
      gridPixels.data,
      gridDims.width,
      gridDims.height
    );
    const filledGrid = fillHoles(grid, gridDims.width, gridDims.height);
    if (filledGrid) grid = filledGrid.mask;

    return {
      grid,
      width: gridDims.width,
      height: gridDims.height,
      score,
      whiteMaskDataUrl: whiteCanvas.toDataURL("image/png"),
    };
  } catch {
    return null;
  }
}

/**
 * Decodes every instance of a concept result, preserving response order
 * (and null slots for undecodable masks) so `selection_logged` indices
 * keep matching the provider response. Browser-only.
 */
async function decodeConceptInstances(
  result: { maskDataUrls: string[]; scores: number[] },
  gridDims: { width: number; height: number },
  naturalDims: { width: number; height: number }
): Promise<Array<DecodedInstance | null>> {
  return Promise.all(
    result.maskDataUrls.map((maskDataUrl, index) =>
      decodeConceptInstance(maskDataUrl, result.scores[index] ?? null, gridDims, naturalDims)
    )
  );
}

// -------------------------------------------------------------------------
// Issue #588: Collapsible workspace panels — localStorage-persisted state
// -------------------------------------------------------------------------

/** Persists collapsed state in localStorage so it survives page reloads. */
function useCollapsiblePanel(storageKey: string, defaultCollapsed = false) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? JSON.parse(stored) : defaultCollapsed;
    } catch {
      return defaultCollapsed;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(isCollapsed));
    } catch {
      // localStorage may be unavailable (private browsing, quota exceeded)
    }
  }, [storageKey, isCollapsed]);

  const toggle = useCallback(() => setIsCollapsed((prev) => !prev), []);

  return { isCollapsed, setIsCollapsed, toggle };
}

/** Panel header label for issue #588 collapsible panels. */
const PANEL_LABELS = {
  brushPanel: "Brush Tools",
  promptPanel: "Prompts & Suggestions",
  variantPanel: "Layers & Variants",
} as const;

interface CollapsibleSectionProps {
  id: keyof typeof PANEL_LABELS;
  title?: string;
  isCollapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Additional className for the outer wrapper */
  className?: string;
}

/**
 * Collapsible section wrapper (issue #588).
 * Renders a clickable header with chevron indicator and collapsible content.
 */
function CollapsibleSection({
  id,
  title,
  isCollapsed,
  onToggle,
  children,
  className = "",
}: CollapsibleSectionProps) {
  const label = title ?? PANEL_LABELS[id];
  return (
    <div className={`rounded-md border border-atelier-taupe/30 ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-atelier-primary hover:bg-atelier-canvas transition-colors"
        aria-expanded={!isCollapsed}
        aria-controls={`collapsible-panel-${id}`}
        title={`${isCollapsed ? "Show" : "Hide"} ${label}`}
      >
        <span>{label}</span>
        {isCollapsed ? (
          <ChevronDown className="h-4 w-4 text-atelier-taupe" aria-hidden="true" />
        ) : (
          <ChevronUp className="h-4 w-4 text-atelier-taupe" aria-hidden="true" />
        )}
      </button>
      {!isCollapsed && (
        <div id={`collapsible-panel-${id}`} className="px-3 pb-3 pt-1">
          {children}
        </div>
      )}
    </div>
  );
}

export default function InpaintEditor({
  roomId,
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
  const [maskBlur, setMaskBlur] = useState(5);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [creativeMode, setCreativeMode] = useState(false);
  const [lockSeed, setLockSeed] = useState(false);
  // Issue #460: comparison now via staged result image click in secondary pane
  const { toasts, showError, showSuccess, dismissToast } = useToast();

  // Issue #560: Zen Mode state — hides all chrome for a distraction-free workspace.
  const [zenMode, setZenMode] = useState(false);
  // Issue #560: dark background toggle for eye comfort in Zen Mode.
  const [zenDarkBackground, setZenDarkBackground] = useState(false);

  // Issue #588: Collapsible workspace panels — persist collapsed state in localStorage.
  const brushPanel = useCollapsiblePanel("inpaint-editor:brushPanel", false);
  const promptPanel = useCollapsiblePanel("inpaint-editor:promptPanel", false);
  const variantPanel = useCollapsiblePanel("inpaint-editor:variantPanel", false);

  // Issue #560: lifted brush state — shared between InpaintMaskCanvas and ZenModeToolbar.
  const [zenBrushSize, setZenBrushSize] = useState(20);
  const [zenActiveTool, setZenActiveTool] = useState<MaskTool>("brush");

  // Issue #561: tracks the active result URL for the version history panel.
  // Updated on inpaint completion; also initialized from prop when provided.
  const [activeResultUrl, setActiveResultUrl] = useState<string | null>(currentResultUrl ?? null);

  // Concept-selection state (issue #228): the detection concept drives
  // ONE billed call per (image, concept); clicks only toggle instances
  // client-side. Issue #229: those toggles ARE the batch selection set —
  // they flow into `batchSelections` through the #203 reducer, so the
  // batch panel's structure, cap, and dispatch are unchanged. There is no
  // other selection source (the old per-click SAM path is gone).
  const [requestedConcept, setRequestedConcept] = useState<string>(DEFAULT_CONCEPT);
  const [displayedResult, setDisplayedResult] = useState<SegmentCacheEntry | null>(null);
  const [decodedInstances, setDecodedInstances] = useState<
    Array<DecodedInstance | null> | null
  >(null);
  const [selectedInstanceIndices, setSelectedInstanceIndices] = useState<number[]>([]);
  const [conceptInput, setConceptInput] = useState("");
  const [conceptInputError, setConceptInputError] = useState<string | null>(null);
  // Issue #249: non-blocking cap notice for "Select all detected" — the
  // control fills the remaining headroom and names what it left out.
  const [selectAllNotice, setSelectAllNotice] = useState<string | null>(null);
  const conceptInputId = useId();
  // Issue #252 D4: per-instance vision labels (parallel to
  // `decodedInstances`; null = unlabeled). Non-blocking: rows render with
  // the concept string until (and unless) labels arrive.
  const [instanceLabels, setInstanceLabels] = useState<Array<string | null> | null>(null);
  // Keys (imageUrl#concept) of detections that cost a billed call — vision
  // labeling fires ONLY for these (cache hits must never bill OpenAI).
  const networkDetectionKeysRef = useRef(new Set<string>());
  // Keys already labeled this session (dedupe across effect re-runs).
  const labeledKeysRef = useRef(new Set<string>());
  const [batchSelections, setBatchSelections] = useState<BatchSelection[]>([]);
  const [unionMaskDataUrl, setUnionMaskDataUrl] = useState<string | null>(null);
  const [selectionReset, setSelectionReset] = useState<{
    id: number;
    maskDataUrl: string | null;
  } | null>(null);
  const selectionResetIdRef = useRef(0);

  // Issue #378: source change undo state
  const previousSourceRef = useRef<InpaintSource | null>(null);
  const [canUndoSource, setCanUndoSource] = useState(false);

  // Issue #203: per-object batch execution state. `activeBatch` holds the
  // running (or failed, awaiting retry) plan + progress; the refs carry
  // run outcomes out of the polling hook (which swallows errors into
  // callbacks) and guard against concurrent batches.
  const [activeBatch, setActiveBatch] = useState<{
    plan: PerObjectBatchPlan;
    progress: BatchProgress;
  } | null>(null);
  const batchActiveRef = useRef(false);
  const batchOutcomeRef = useRef<{ kind: "completed"; url: string } | null>(null);
  const batchFailureRef = useRef<string | null>(null);

  // Issue #230: the single-object editor path (brush → staging
  // directives → Apply Inpainting) pre-fills the parent's directives
  // when a labeled selection is active. Exactly one labeled selection
  // names the mask unambiguously; with zero or several selections the
  // single-object prompt stays untouched (the batch panel owns those
  // flows). Fired through a ref so the effect keys on the label alone —
  // the parent's inline handler identity may churn every render.
  const activeConceptLabel =
    batchSelections.length === 1 ? batchSelections[0].conceptLabel ?? null : null;
  const activeConceptLabelCallbackRef = useRef(onActiveConceptLabelChange);
  useEffect(() => {
    activeConceptLabelCallbackRef.current = onActiveConceptLabelChange;
  });
  useEffect(() => {
    activeConceptLabelCallbackRef.current?.(activeConceptLabel);
  }, [activeConceptLabel]);

  // Issue #228 (rekeying the issue #202 point cache): in-session cache of
  // concept detections. Repeat selections of an already-detected (image,
  // concept) pair — chip re-clicks, toggles after a Clear Mask, returning
  // from another concept — come back instantly with zero billed calls.
  // One instance per mount, cleared on source switch — the lifecycle that
  // makes same-URL keying safe is documented in segment-cache.ts.
  const segmentCacheRef = useRef<SegmentCache | null>(null);
  if (!segmentCacheRef.current) {
    segmentCacheRef.current = new SegmentCache();
  }

  // Issue #228: auto-fire the `furniture` catch-all detection the moment
  // the editor's image has loaded — the real call IS the prewarm (the old
  // `warm: true` ping is gone; one call per (image, concept) returns every
  // instance, so there is nothing cheaper to warm with). Chip switches
  // reuse this machinery; the SegmentCache serves repeats without a fetch.
  const conceptSegments = useConceptSegments({
    enabled: true,
    roomId,
    imageUrl: imageUrl || null,
    imageWidth: imageDims?.width ?? null,
    imageHeight: imageDims?.height ?? null,
    concept: requestedConcept,
    resolveCached: useCallback(
      (concept: string) => segmentCacheRef.current?.peek(imageUrl, concept) ?? null,
      [imageUrl]
    ),
  });
  const conceptLoading = conceptSegments.status === "warming";

  // Install fetched results into the cache so re-selecting the concept
  // later is free (the hook itself never writes the cache). The fetched
  // key is recorded as a BILLED detection — the trigger for optional
  // vision labeling (issue #252 D4); cache hits never get that marker.
  useEffect(() => {
    if (conceptSegments.result) {
      networkDetectionKeysRef.current.add(`${imageUrl}#${conceptSegments.result.concept}`);
      segmentCacheRef.current?.put(
        imageUrl,
        conceptSegments.result.concept,
        conceptSegments.result
      );
    }
  }, [conceptSegments.result, imageUrl]);

  // Issue #252 D4: ONE batched GPT-4o-mini vision request per billed
  // detection names every instance. Non-blocking by design — rows render
  // with the concept string until labels land, and any failure just keeps
  // that fallback (AC-3.2). Labeled results are written back into the
  // segment cache, so cache-served concepts restore labels instantly.
  useEffect(() => {
    if (!roomId || !imageUrl || !imageDims) return;
    if (!displayedResult || !decodedInstances) return;

    // Cache-served labels restore instantly (no network, no billing).
    if (displayedResult.labels) {
      setInstanceLabels(displayedResult.labels);
      return;
    }
    const key = `${imageUrl}#${displayedResult.concept}`;
    if (!networkDetectionKeysRef.current.has(key)) return;
    if (labeledKeysRef.current.has(key)) return;
    labeledKeysRef.current.add(key);

    let cancelled = false;
    void (async () => {
      // crossOrigin=anonymous keeps the crop canvas untainted so
      // toDataURL can rasterize crops (the storage mock and Supabase both
      // send permissive CORS headers; a CORS failure just skips labeling).
      const sourceImg = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = imageUrl;
      });
      if (!sourceImg) return;
      const crops: Array<{ instanceIndex: number; cropDataUrl: string }> = [];
      for (let index = 0; index < decodedInstances.length; index++) {
        const instance = decodedInstances[index];
        if (!instance) continue;
        const bounds = maskBounds(instance.grid, instance.width, instance.height);
        if (!bounds) continue;
        // Grid (mask-canvas) space → natural pixel space for the crop.
        const scaleX = imageDims.width / instance.width;
        const scaleY = imageDims.height / instance.height;
        const naturalBounds = {
          minX: Math.floor(bounds.minX * scaleX),
          minY: Math.floor(bounds.minY * scaleY),
          maxX: Math.ceil(bounds.maxX * scaleX),
          maxY: Math.ceil(bounds.maxY * scaleY),
        };
        const cropDataUrl = await cropInstanceDataUrl(sourceImg, naturalBounds, imageDims);
        if (cancelled) return;
        if (cropDataUrl) crops.push({ instanceIndex: index, cropDataUrl });
      }
      if (cancelled || crops.length === 0) return;
      try {
        const response = await fetch("/api/label-instances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            imageUrl,
            concept: displayedResult.concept,
            crops,
          }),
        });
        if (!response.ok) return;
        const data = (await response.json()) as { labels?: unknown };
        if (!Array.isArray(data.labels)) return;
        const labels: Array<string | null> = new Array(displayedResult.maskDataUrls.length).fill(
          null
        );
        for (const entry of data.labels) {
          if (
            entry &&
            typeof entry === "object" &&
            typeof (entry as { instanceIndex?: unknown }).instanceIndex === "number" &&
            typeof (entry as { label?: unknown }).label === "string"
          ) {
            const index = (entry as { instanceIndex: number }).instanceIndex;
            if (index >= 0 && index < labels.length) labels[index] = (entry as { label: string }).label;
          }
        }
        if (cancelled) return;
        setInstanceLabels(labels);
        segmentCacheRef.current?.put(imageUrl, displayedResult.concept, {
          maskDataUrls: displayedResult.maskDataUrls,
          scores: displayedResult.scores,
          labels,
        });
      } catch {
        // Silent by design: labels are enrichment, the concept fallback stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [displayedResult, decodedInstances, imageUrl, imageDims, roomId]);

  // Surface hook results for the active concept (cache-served or fetched).
  useEffect(() => {
    if (conceptSegments.result && conceptSegments.result.concept === requestedConcept) {
      setDisplayedResult(conceptSegments.result);
    }
  }, [conceptSegments.result, requestedConcept]);

  // Concept switching: serve the cache instantly (zero flicker, zero
  // network) and reset the per-concept toggle state. Uncached concepts
  // fall through to the hook's fetch above.
  const handleConceptChange = useCallback(
    (concept: string) => {
      setRequestedConcept(concept);
      setConceptInputError(null);
      setDisplayedResult(segmentCacheRef.current?.get(imageUrl, concept) ?? null);
      setInstanceLabels(null);
      // Toggle state is per-concept (issue #228); the batch set mirrors
      // the toggles (issue #229), so it resets with them.
      setSelectedInstanceIndices([]);
      setBatchSelections([]);
      setSelectAllNotice(null);
    },
    [imageUrl]
  );

  // Free-text concept: normalized (capitals forgiven, issue #249) then
  // validated client-side (mirroring the server's segmentConceptSchema)
  // BEFORE any billed call can be built.
  const handleConceptSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = normalizeConceptInput(conceptInput);
    if (!isValidConceptName(candidate)) {
      setConceptInputError(
        'Use a single lowercase word or short phrase — 1–30 characters, lowercase letters, spaces, and hyphens only (no commas, numbers, or sentences). Try "sofa" or "wall art".'
      );
      return;
    }
    setConceptInput("");
    handleConceptChange(candidate);
  };

  // Decode the displayed result's alpha cutouts into hit-test grids (at
  // the mask-canvas resolution — click points arrive in that space) plus
  // white-on-black masks for the toggle path. Undecodable masks keep
  // their (null) slot so response indices stay stable.
  useEffect(() => {
    if (!displayedResult || displayedResult.maskDataUrls.length === 0 || !imageDims) {
      setDecodedInstances(null);
      return;
    }
    let cancelled = false;
    const gridDims = computeMaskCanvasDimensions(imageDims.width / imageDims.height);
    void decodeConceptInstances(displayedResult, gridDims, imageDims).then((instances) => {
      if (!cancelled) setDecodedInstances(instances);
    });
    return () => {
      cancelled = true;
    };
  }, [displayedResult, imageDims]);

  // Overlay descriptors for the canvas's tinted instance layer. Since
  // issue #252 D2/D4, SELECTED instances tint with their REGION's palette
  // color (all members of a merged region share one color — matching the
  // region's badge and panel chip); detected-only instances keep their
  // score-rank color.
  const instanceOverlays = useMemo(() => {
    if (!displayedResult || !decodedInstances) return undefined;
    const regionIndexByInstance = new Map<number, number>();
    batchSelections.forEach((selection, position) => {
      for (const member of selection.memberInstanceIndices ?? []) {
        regionIndexByInstance.set(member, position);
      }
    });
    const overlays: Array<{
      id: string;
      maskDataUrl: string;
      rank: number;
      selected: boolean;
      colorIndex?: number;
    }> = [];
    for (let index = 0; index < displayedResult.maskDataUrls.length; index++) {
      const instance = decodedInstances[index];
      if (!instance) continue;
      const selected = selectedInstanceIndices.includes(index);
      const regionIndex = regionIndexByInstance.get(index);
      overlays.push({
        id: `${displayedResult.concept}:${index}`,
        maskDataUrl: displayedResult.maskDataUrls[index],
        rank: index,
        selected,
        ...(selected && regionIndex !== undefined ? { colorIndex: regionIndex } : {}),
      });
    }
    return overlays;
  }, [displayedResult, decodedInstances, selectedInstanceIndices, batchSelections]);

  // Issue #252 D4: numbered canvas badges, one per pending region, positioned
  // at the topmost-leftmost pixel of the region's member union (grid space
  // scaled to natural pixels) so a merged region is anchored on its actual
  // shape rather than any single member's seed point.
  const selectionMarkers = useMemo(() => {
    if (!decodedInstances || batchSelections.length === 0) return undefined;
    if (!imageDims) return undefined;
    return batchSelections.flatMap((selection, position) => {
      const members = selection.memberInstanceIndices ?? [];
      // Union's topmost-leftmost pixel = the minimum (y, then x) over the
      // members' own topmost-leftmost points (D4).
      let best: { x: number; y: number } | null = null;
      for (const member of members) {
        const instance = decodedInstances[member];
        if (!instance) continue;
        const point = topmostLeftmostPoint(instance.grid, instance.width, instance.height);
        if (!point) continue;
        if (!best || point.y < best.y || (point.y === best.y && point.x < best.x)) best = point;
      }
      if (!best) return [];
      return [
        {
          id: selection.id,
          x: best.x * (imageDims.width / (decodedInstances[0]?.width ?? imageDims.width)),
          y: best.y * (imageDims.height / (decodedInstances[0]?.height ?? imageDims.height)),
          index: position + 1,
        },
      ];
    });
  }, [batchSelections, decodedInstances, imageDims]);

  // The source in effect for the CURRENT run, captured at start time so the
  // completion callback reports the right one even if the selector (or the
  // pending-request props) change while a run is in flight.
  const runSourceRef = useRef<InpaintSource>(pendingSource ?? source);

  // Issue #203: the status hook routes success/failure through these
  // callbacks, and `start()` itself never throws — so batch steps report
  // outcomes through refs. While a per-object batch is active, the generic
  // success toast is suppressed (the batch panel shows per-step progress)
  // and failures are captured for the panel's retry affordance instead of
  // the toast's own single-step retry.
  const { isProcessing, statusText, start } = useInpaintStatus({
    onCompleted: (resultImageUrl) => {
      batchOutcomeRef.current = { kind: "completed", url: resultImageUrl };
      // Update the active result URL for the version history panel (issue #561)
      setActiveResultUrl(resultImageUrl);
      onInpaintComplete?.(resultImageUrl, runSourceRef.current);
      // Issue #561: save the completed version to the history. Thumbnail
      // generation requires browser canvas, so run it here. Errors are
      // non-fatal — the version row is best-effort.
      if (typeof window !== "undefined" && resultImageUrl) {
        void (async () => {
          try {
            const thumbnailDataUrl = await generateThumbnailFromUrl(resultImageUrl, 200);
            await saveInpaintVersion({
              roomId,
              variantSlot,
              resultUrl: resultImageUrl,
              thumbnailDataUrl,
              seed: undefined,
              promptDirectives,
            });
          } catch (err) {
            console.error("[inpaint-editor] failed to save inpaint version:", err);
          }
        })();
      }
    },
    showSuccess: (message) => {
      if (!batchActiveRef.current) showSuccess(message);
    },
    showError: (message, retryable, onRetry, retryLabel) => {
      if (batchActiveRef.current) {
        batchFailureRef.current = message;
        return;
      }
      showError(message, retryable, onRetry, retryLabel);
    },
  });

  // Instance toggling (issue #228): pure client-side hit-test against the
  // decoded grids — re-clicks and re-toggles never cost a network call.
  // Every toggle emits the training-corpus `selection_logged` event (W3
  // depends on this shape). Issue #229: the toggle also drives the batch
  // selection set — ON routes through the #203 reducer (cap + duplicate
  // rules inherited, no new limit logic) and a refused add leaves the
  // instance untinted, so the panel and the canvas always agree.
  const handleInstanceToggle = useCallback(
    (point: { x: number; y: number }) => {
      if (isProcessing) return;
      if (!displayedResult || !decodedInstances) return;
      const hit = findInstanceAtPoint(decodedInstances, point);
      if (hit === null) return;
      const instance = decodedInstances[hit];
      if (!instance) return;
      // Issue #252 D2: proximity merging engages when instance grids are
      // available — toggling a mask within MERGE_PROXIMITY_PX of an
      // existing region's members fuses into that region (one row, one
      // prompt, one billed run; the region mask is recomposed below).
      const instanceGrids = new Map<number, InstanceMaskGrid>();
      decodedInstances.forEach((decoded, index) => {
        if (decoded) {
          instanceGrids.set(index, {
            grid: decoded.grid,
            width: decoded.width,
            height: decoded.height,
          });
        }
      });
      const toggled = applyConceptToggle(
        batchSelections,
        selectedInstanceIndices,
        {
          id: `${displayedResult.concept}:${hit}`,
          point,
          maskDataUrl: instance.whiteMaskDataUrl,
          conceptLabel: displayedResult.concept,
        },
        hit,
        !selectedInstanceIndices.includes(hit),
        { instanceGrids }
      );
      if (toggled.rejected === "cap") {
        showError(
          `Batch staging is limited to ${MAX_BATCH_OBJECTS} regions — undo or clear one to add more.`
        );
        return;
      }
      if (toggled.rejected === "duplicate") {
        showError(
          "That spot rounds to an already-selected object's click point — toggle that one off first."
        );
        return;
      }
      setSelectedInstanceIndices(toggled.selectedInstanceIndices);
      setBatchSelections(toggled.selections);
      const selectionEvent = buildSelectionLoggedEvent({
        roomId,
        concept: displayedResult.concept,
        instanceIndex: hit,
        score: instance.score,
      });
      console.log(
        `${CONCEPT_EVENT_LOG_PREFIX} ${JSON.stringify(selectionEvent)}`
      );
      // Durable write for training corpus (issue #238 / W3)
      logSelectionEvent({
        roomId,
        concept: selectionEvent.concept,
        instanceIndex: selectionEvent.instanceIndex,
        score: selectionEvent.score ?? 0,
        editedLabel: selectionEvent.editedLabel,
      }).catch((err) =>
        console.error("[selection-log] failed to persist:", err)
      );
    },
    [
      isProcessing,
      displayedResult,
      decodedInstances,
      roomId,
      batchSelections,
      selectedInstanceIndices,
      showError,
    ]
  );

  // "Select all detected" (issue #249): bulk toggle-on over every decoded
  // instance of the active concept, in rank order. Routing through
  // applyConceptSelectAll keeps the cap + duplicate rules as the ONLY
  // limit logic and moves both state pieces in lockstep; each instance
  // this call actually selects emits its own selection_logged event (the
  // same shape a click toggle emits — the corpus wants every selection).
  // When detection found more than MAX_BATCH_OBJECTS, the best-ranked fit
  // is selected and a role=status notice names what was left out.
  const handleSelectAllDetected = useCallback(() => {
    if (isProcessing) return;
    if (!displayedResult || !decodedInstances) return;
    const candidates: ConceptSelectAllCandidate[] = [];
    for (let index = 0; index < decodedInstances.length; index++) {
      const instance = decodedInstances[index];
      if (!instance) continue;
      const seed = instanceSeedPoint(instance);
      if (!seed) continue;
      candidates.push({
        instanceIndex: index,
        entry: {
          id: `${displayedResult.concept}:${index}`,
          point: seed,
          maskDataUrl: instance.whiteMaskDataUrl,
          conceptLabel: displayedResult.concept,
        },
        score: instance.score,
        grid: { grid: instance.grid, width: instance.width, height: instance.height },
      });
    }
    const result = applyConceptSelectAll(batchSelections, selectedInstanceIndices, candidates);
    setSelectedInstanceIndices(result.selectedInstanceIndices);
    setBatchSelections(result.selections);
    for (const index of result.addedInstanceIndices) {
      const instance = decodedInstances[index];
      const selectionEvent = buildSelectionLoggedEvent({
        roomId,
        concept: displayedResult.concept,
        instanceIndex: index,
        score: instance?.score ?? null,
      });
      console.log(
        `${CONCEPT_EVENT_LOG_PREFIX} ${JSON.stringify(selectionEvent)}`
      );
      // Durable write for training corpus (issue #238 / W3)
      logSelectionEvent({
        roomId,
        concept: selectionEvent.concept,
        instanceIndex: selectionEvent.instanceIndex,
        score: selectionEvent.score ?? 0,
        editedLabel: selectionEvent.editedLabel,
      }).catch((err) =>
        console.error("[selection-log] failed to persist:", err)
      );
    }
    setSelectAllNotice(
      result.truncated
        ? `Selected ${result.selections.length} of ${candidates.length} detected — batch staging is limited to ${MAX_BATCH_OBJECTS} regions.`
        : null
    );
  }, [
    isProcessing,
    displayedResult,
    decodedInstances,
    roomId,
    batchSelections,
    selectedInstanceIndices,
  ]);
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
  // Issue #588: backtick (`) toggles all collapsible panels.
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

      if (e.key === "Escape" && zenMode) {
        e.preventDefault();
        setZenMode(false);
      }

      // Issue #588: backtick toggles all workspace panels
      if (e.key === "`" && !isInput) {
        e.preventDefault();
        const allCollapsed =
          brushPanel.isCollapsed && promptPanel.isCollapsed && variantPanel.isCollapsed;
        if (allCollapsed) {
          brushPanel.setIsCollapsed(false);
          promptPanel.setIsCollapsed(false);
          variantPanel.setIsCollapsed(false);
        } else {
          brushPanel.setIsCollapsed(true);
          promptPanel.setIsCollapsed(true);
          variantPanel.setIsCollapsed(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zenMode, brushPanel, promptPanel, variantPanel]);

  // Resume an in-flight job (e.g. after a refresh): skip the submit and go
  // straight to polling the persisted requestId. The run's source comes from
  // the persisted row so completion persists with the original run's
  // semantics (issue #170).
  useEffect(() => {
    if (!pendingRequestId) return;
    runSourceRef.current = pendingSource ?? source;
    void start(async () => pendingRequestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume once per requestId, matching the pre-#170 behavior
  }, [pendingRequestId, start]);

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
      // union/reset state follows the selection set via effects.
      setBatchSelections([]);
      regionMaskCacheRef.current.clear();
      setInstanceLabels(null);
      segmentCacheRef.current?.clear();
      setRequestedConcept(DEFAULT_CONCEPT);
      setDisplayedResult(null);
      setDecodedInstances(null);
      setSelectedInstanceIndices([]);
      setConceptInputError(null);
      setSelectAllNotice(null);
      onSourceChange?.(next);
    },
    [source, onSourceChange]
  );

  // Issue #378: undo source change by restoring the previous source
  const handleUndoSource = useCallback(() => {
    if (!previousSourceRef.current) return;
    const prev = previousSourceRef.current;
    // Restore the previous source by calling handleSourceChange with the previous source
    // This will trigger the full reset logic that handleSourceChange does
    previousSourceRef.current = source;
    setMaskDataUrl(null);
    setBatchSelections([]);
    regionMaskCacheRef.current.clear();
    setInstanceLabels(null);
    segmentCacheRef.current?.clear();
    setRequestedConcept(DEFAULT_CONCEPT);
    setDisplayedResult(null);
    setDecodedInstances(null);
    setSelectedInstanceIndices([]);
    setConceptInputError(null);
    setSelectAllNotice(null);
    onSourceChange?.(prev);
  }, [source, onSourceChange]);

  // Issue #203 (simplified by #229): keep the union mask (for thematic
  // runs + the batch panel) and the canvas's selection reset in lockstep
  // with the batch selection set — since #229 the toggled concept
  // instances ARE that set, so one source drives everything. The reset
  // carries an incrementing id so every change applies exactly once; an
  // empty set resets the grid to black (Clear Mask semantics). Concept
  // masks arrive as white-on-black data URLs at the photo's natural
  // dimensions, the same geometry the batch set is normalized to, so
  // `composeUnionMaskDataUrl` takes them unchanged.
  useEffect(() => {
    if (!imageDims) return;
    let cancelled = false;
    const compose = async () => {
      const unionUrl =
        batchSelections.length > 0
          ? await composeUnionMaskDataUrl(
              batchSelections.map((selection) => selection.maskDataUrl),
              imageDims.width,
              imageDims.height
            )
          : null;
      if (cancelled) return;
      setUnionMaskDataUrl(unionUrl);
      selectionResetIdRef.current += 1;
      setSelectionReset({ id: selectionResetIdRef.current, maskDataUrl: unionUrl });
    };
    void compose();
    return () => {
      cancelled = true;
    };
  }, [batchSelections, imageDims]);

  // Issue #252 D2: keep merged regions' masks composed from their members —
  // union → closing → hole fill at the photo's natural dimensions (WYSIWYG:
  // the canvas tint, the dispatched per-region mask, and the thematic union
  // all agree). Single-instance regions keep their decoded white mask, so
  // only multi-member regions are recomposed here. The cache is keyed by
  // id + membership, so a merge that later gains another member recomposes
  // exactly once.
  const regionMaskCacheRef = useRef(new Map<string, string>());
  useEffect(() => {
    if (!imageDims) return;
    const pending = batchSelections.filter((selection) => {
      const members = selection.memberInstanceIndices;
      if (!members || members.length <= 1) return false;
      const key = `${selection.id}:${members.join(",")}`;
      return regionMaskCacheRef.current.get(key) !== selection.maskDataUrl;
    });
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      const gridEntry = decodedInstances?.find((instance) => instance) ?? null;
      const naturalLong = Math.max(imageDims.width, imageDims.height);
      const gridLong = gridEntry
        ? Math.max(gridEntry.width, gridEntry.height)
        : naturalLong;
      // MERGE_PROXIMITY_PX is defined in mask-canvas grid pixels; scale it
      // to the natural-dimension space the region masks live in.
      const closeRadius = Math.max(1, Math.round(MERGE_PROXIMITY_PX * (naturalLong / gridLong)));
      for (const selection of pending) {
        const members = selection.memberInstanceIndices ?? [];
        const memberUrls = members
          .map((index) => decodedInstances?.[index]?.whiteMaskDataUrl)
          .filter((url): url is string => Boolean(url));
        if (memberUrls.length !== members.length) continue;
        const url = await composeRegionMaskDataUrl(
          memberUrls,
          imageDims.width,
          imageDims.height,
          closeRadius
        );
        if (cancelled) return;
        if (!url) continue;
        const key = `${selection.id}:${members.join(",")}`;
        regionMaskCacheRef.current.set(key, url);
        setBatchSelections((previous) =>
          previous.map((candidate) =>
            candidate.id === selection.id &&
            (candidate.memberInstanceIndices ?? []).join(",") === members.join(",")
              ? { ...candidate, maskDataUrl: url }
              : candidate
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batchSelections, imageDims, decodedInstances]);

  // Issue #203: a selection-set change invalidates a finished (e.g.
  // failed) batch's plan — drop it so the panel never offers a retry
  // against masks that are no longer selected. Active batches keep theirs.
  useEffect(() => {
    if (!batchActiveRef.current) {
      setActiveBatch(null);
    }
  }, [batchSelections]);

  // Shared submit path for brush runs, holistic spike runs (issue #190),
  // and batch runs (issue #203): all post the same body to /api/inpaint;
  // holistic runs add the negativePrompt override and swap mask/directives
  // for the strategy-generated ones. Batch steps pass `sourceUrl` (the
  // previous step's persisted result) so per-object results stack into the
  // same variant slot; omitted = the editor's current source image.
  // Issue #562: globalDirectives are merged with room directives for AI prompts.
  const beginInpaintRun = useCallback(
    async (run: {
      maskUrl: string;
      promptDirectives: string;
      negativePrompt?: string;
      sourceUrl?: string;
      globalDirectives?: string;
      // Issue #558: AI guidance
      promptStrength?: number;
      maskBlur?: number;
      seed?: number;
      creativeMode?: boolean;
      lockSeed?: boolean;
    }) => {
      // Issue #562: merge global + room directives for AI
      const mergedDirectives = (() => {
        const global = (run.globalDirectives ?? globalDirectives ?? "").trim();
        const room = run.promptDirectives.trim();
        if (!global) return room;
        if (!room) return global;
        return `${global}\n\nRoom-specific: ${room}`;
      })();

      if (!mergedDirectives) {
        showError("No staging directives available.");
        return;
      }
      if (!imageUrl) {
        showError("No image available to edit.");
        return;
      }

      runSourceRef.current = source;
      // Issue #203: each run reports its outcome through this ref (the
      // status hook swallows errors into callbacks). Reset per run so a
      // stale completion can never be attributed to the next one.
      batchOutcomeRef.current = null;
      batchFailureRef.current = null;

      // Issue #558: resolve effective seed — use explicit seed only when lockSeed is true
      const effectiveSeed = run.lockSeed ? run.seed : undefined;

      await start(async (signal) => {
        const startResponse = await fetch("/api/inpaint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageUrl: run.sourceUrl ?? imageUrl,
            maskUrl: run.maskUrl,
            promptDirectives: mergedDirectives,
            negativePrompt: run.negativePrompt,
            aesthetic,
            roomId,
            variantSlot,
            sourceSlot: source.kind === "variant" ? source.slot : null,
            // Issue #558: AI guidance params
            promptStrength: run.promptStrength,
            maskBlur: run.maskBlur,
            seed: effectiveSeed,
            creativeMode: run.creativeMode,
          }),
          signal,
        });

        const startData = await startResponse.json();

        if (!startResponse.ok) {
          throw new Error(startData.message || startData.error || "Failed to start inpainting");
        }

        return startData.requestId as string;
      });
    },
    [imageUrl, aesthetic, roomId, variantSlot, source, start, showError, globalDirectives]
  );

  const handleInpaint = useCallback(async () => {
    if (!promptDirectives.trim()) {
      showError("Please fill in the \u201cStaging directives\u201d textarea in the right panel.");
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

  // Issue #203: sequential per-object batch runner. Steps run ONE AT A
  // TIME through the shared submit path (never parallel — fal queue
  // handling, polling, and persistence stay exactly as-is), each pairing
  // an object's mask with its prompt and writing into the same variant
  // slot. Step N+1 edits step N's persisted result URL, so results stack.
  //
  // Atomicity (deliberately simple): every step is a complete, fully
  // persisted inpaint run. On a failed step the loop stops, keeping
  // earlier steps' results in the variant; the panel offers "Retry
  // remaining", which resumes from the first unfinished step and chains
  // again from the last completed result. No rollbacks, no transactions.
  const runPerObjectBatch = useCallback(
    async (plan: PerObjectBatchPlan, startProgress?: BatchProgress) => {
      if (batchActiveRef.current) return;
      batchActiveRef.current = true;
      let progress = startProgress ?? initialBatchProgress(plan.steps);
      setActiveBatch({ plan, progress });
      let sourceUrl: string | undefined;

      try {
        for (let index = 0; index < plan.steps.length; index++) {
          const step = progress.steps[index];
          if (step.status === "completed") {
            // Retry pass: resume chaining from the last persisted result.
            sourceUrl = step.resultUrl ?? sourceUrl;
            continue;
          }

          progress = advanceBatchProgress(progress, { kind: "start", index });
          setActiveBatch({ plan, progress });

          await beginInpaintRun({
            maskUrl: plan.steps[index].maskDataUrl,
            promptDirectives: plan.steps[index].promptDirectives,
            sourceUrl,
            globalDirectives,
            promptStrength,
            maskBlur,
            seed,
            creativeMode,
            lockSeed,
          });

          const outcome = batchOutcomeRef.current;
          if (outcome?.kind === "completed") {
            sourceUrl = outcome.url;
            progress = advanceBatchProgress(progress, {
              kind: "complete",
              index,
              resultUrl: outcome.url,
            });
            setActiveBatch({ plan, progress });
            continue;
          }

          progress = advanceBatchProgress(progress, {
            kind: "fail",
            index,
            message: batchFailureRef.current ?? "Inpainting failed for this object.",
          });
          setActiveBatch({ plan, progress });
          return; // earlier results stay; unfinished steps await retry
        }

        batchActiveRef.current = false;
        setActiveBatch(null);
        setBatchSelections([]);
        setSelectedInstanceIndices([]);
        showSuccess(
          `Batch complete — ${plan.steps.length} ${
            plan.steps.length === 1 ? "region" : "regions"
          } staged.`
        );
      } finally {
        batchActiveRef.current = false;
      }
    },
    [beginInpaintRun, showSuccess, globalDirectives, promptStrength, maskBlur, seed, creativeMode, lockSeed]
  );

  // Issue #203: batch entry point from the panel. Builds the validated
  // plan (pure logic in multi-select-batch.ts), then either runs the
  // thematic single run (union mask + one prompt through the shared
  // launcher) or kicks off the sequential per-object runner.
  const handleBatchRun = useCallback(
    (input: {
      mode: BatchPromptMode;
      thematicPrompt: string;
      perObjectPrompts: string[];
      declutterMode: boolean;
      declutterIntensity: DeclutterIntensity;
    }) => {
      const built = buildBatchPlan({
        selections: batchSelections,
        mode: input.mode,
        thematicPrompt: input.thematicPrompt,
        perObjectPrompts: input.perObjectPrompts,
        unionMaskDataUrl,
        declutterMode: input.declutterMode,
        declutterIntensity: input.declutterIntensity,
      });
      if (!built.ok) {
        showError(built.error);
        return;
      }
      const plan = built.plan;
      if (plan.kind === "thematic") {
        void beginInpaintRun({
          maskUrl: plan.maskDataUrl,
          promptDirectives: plan.promptDirectives,
          globalDirectives,
          promptStrength,
          maskBlur,
          seed,
          creativeMode,
          lockSeed,
        }).then(() => {
          // A thematic batch is one ordinary run — consume the selection
          // set only when it actually completed (outcome ref is set by
          // onCompleted; beginInpaintRun resets it per run). The tinted
          // instance indices follow the set (issue #229 lockstep).
          if (batchOutcomeRef.current?.kind === "completed") {
            setBatchSelections([]);
            setSelectedInstanceIndices([]);
          }
        });
        return;
      }
      void runPerObjectBatch(plan);
    },
    [batchSelections, unionMaskDataUrl, beginInpaintRun, runPerObjectBatch, showError, globalDirectives, promptStrength, maskBlur, seed, creativeMode, lockSeed]
  );

  const handleBatchRetry = useCallback(() => {
    if (!activeBatch) return;
    void runPerObjectBatch(activeBatch.plan, activeBatch.progress);
  }, [activeBatch, runPerObjectBatch]);

  const handleRemoveLastSelection = useCallback(() => {
    setBatchSelections((previous) =>
      reduceSelectionSet(previous, { type: "removeLast" }).selections
    );
  }, []);

  // Issue #448: remove a specific selection by id
  const handleRemoveSelection = useCallback((id: string) => {
    setBatchSelections((previous) =>
      reduceSelectionSet(previous, { type: "remove", id }).selections
    );
  }, []);

  const handleClearSelection = useCallback(() => {
    // Issue #249: the canvas's selected-instance tints follow the set —
    // a clear must empty BOTH pieces or solid-filled instances would
    // outlive the panel that ran them.
    setBatchSelections([]);
    setSelectedInstanceIndices([]);
    setSelectAllNotice(null);
  }, []);

  // Clear Mask (canvas button) empties the grid — the selection state must
  // follow so nothing describes objects the canvas no longer masks.
  const handleMaskCleared = useCallback(() => {
    setBatchSelections([]);
    setSelectedInstanceIndices([]);
  }, []);

  // Issue #249: bulk-affordance enablement. `detectedCount` is the active
  // concept's decodable instances; `selectionCount` is whichever state
  // piece is ahead (they move in lockstep — the max guards a transient
  // render between the two setState calls).
  const detectedCount = decodedInstances?.filter(Boolean).length ?? 0;
  const selectionCount = Math.max(batchSelections.length, selectedInstanceIndices.length);

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
      } ${zenMode ? "zen-mode-active zen-mode-vignette" : ""} ${zenDarkBackground && zenMode ? "zen-mode-dark" : ""}`}
    >
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
            className={zenMode ? "zen-mode-hidden" : ""}
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
        {/* Issue #547/#546: sticky header per Atelier Canvas spec with Atelier Canvas colors */}
        <div className={`sticky top-0 z-20 flex items-center justify-between bg-atelier-canvas ${zenMode ? "zen-mode-hidden" : ""}`}>
          <h4 className="mb-2 font-jakarta text-sm font-medium text-atelier-primary">Source Image</h4>
          <button
            type="button"
            onClick={() => setZenMode((prev) => !prev)}
            title={zenMode ? "Exit Zen Mode (Z)" : "Enter Zen Mode (Z)"}
            aria-label={zenMode ? "Exit Zen Mode" : "Enter Zen Mode"}
            className="flex items-center gap-1.5 rounded-md border border-atelier-taupe/40 bg-white px-2.5 py-1.5 text-xs text-atelier-taupe shadow-sm transition-colors hover:bg-atelier-canvas hover:text-atelier-primary"
          >
            {zenMode ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {zenMode ? "Exit Zen" : "Zen Mode"}
          </button>
        </div>
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
        />

        {/* Issue #560: expand selection and floor shadow controls hidden in Zen Mode */}
        <div className={zenMode ? "zen-mode-hidden" : ""}>
          <label className="flex items-center gap-2 font-jakarta text-sm text-atelier-primary">
            Expand selection:
            <input
              type="range"
              min={0}
              max={MAX_MASK_EXPANSION_RADIUS}
              value={maskExpansion}
              onChange={(e) => setMaskExpansion(Number(e.target.value))}
              aria-describedby="mask-expansion-hint"
              className="atelier-slider w-32"
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
              onChange={(e) => setIncludeFloorShadow(e.target.checked)}
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
      </div>

      {/* Issue #560: right panel hidden in Zen Mode */}
      <div
        className={`flex w-full flex-col gap-3 no-print ${fullWidth ? "md:w-full md:flex-col lg:min-h-0 lg:w-[380px] lg:shrink-0" : ""} ${zenMode ? "zen-mode-hidden" : ""}`}
      >
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
              onSelectTab={setActiveTab}
              idBase={tabIdBase}
            />
          </div>

          {/* Tab panels stay MOUNTED (hidden, not unmounted) so tab
              switching performs zero state transitions — the batch
              panel's prompts and mode survive round-trips (AC-L5). */}
          <div
            role="tabpanel"
            id={editorTabPanelId(tabIdBase, "entire")}
            aria-labelledby={editorTabId(tabIdBase, "entire")}
            hidden={effectiveTab !== "entire"}
          >
            <div className="flex flex-col gap-6">
              {/* Issue #191/#223 one-click preset, demoted to an optional
                  shortcut by issue #223: the brush → Apply Inpainting flow
                  is the primary path and works on any source without
                  running the preset first. The preset detects furnishings
                  and restages only those regions (see
                  stage-entire-room-preset.tsx). Entire-room staging only
                  ever runs over the original photo (AC-L4). */}
              <StageEntireRoomPreset
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

            </div>
          </div>

          <div
            role="tabpanel"
            id={editorTabPanelId(tabIdBase, "manual")}
            aria-labelledby={editorTabId(tabIdBase, "manual")}
            hidden={effectiveTab !== "manual"}
          >
            <div className="flex flex-col gap-3">
              {/* Issue #507: inline staging directives textarea — always visible
                  in the right panel beside the Apply Inpainting button, so users
                  can find it without scrolling the left pane. */}
              <div>
                <label
                  htmlFor={`inpaint-directives-${roomId}`}
                  className="mb-1 font-jakarta block text-sm font-medium text-atelier-primary"
                >
                  Staging directives (required)
                </label>
                <textarea
                  id={`inpaint-directives-${roomId}`}
                  value={directivesValue ?? promptDirectives}
                  onChange={(e) => onDirectivesChange?.(e.target.value)}
                  rows={3}
                  placeholder="e.g., Modern coastal furniture, light neutrals, natural textures, minimal accessories..."
                  className="w-full px-3 py-2 rounded-md border border-border text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
              {/* Manual-paint controls (AC-L7): the single-object run affordance.
                  The brush / Fill Region / Select Regions toggles live in the
                  canvas toolbar and stay beside the canvas on every tab, so
                  painted work is always visible. The "Expand selection" slider
                  above controls mask expansion and is shared across all tabs. */}
              <div className="flex items-center gap-4">
                <button
                  onClick={handleInpaint}
                  disabled={isProcessing || conceptLoading || !maskDataUrl}
                  title={!maskDataUrl ? "Paint on the image to select the area you want to regenerate" : undefined}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
                    transition-colors
                    ${isProcessing || conceptLoading || !maskDataUrl
                      ? "bg-atelier-taupe/40 text-atelier-taupe cursor-not-allowed"
                      : "bg-atelier-primary text-white hover:bg-atelier-primary/80"
                    }
                  `}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    "Apply Inpainting"
                  )}
                </button>

                {isProcessing && statusText && (
                  <span aria-live="polite" className="text-sm text-atelier-taupe">{statusText}</span>
                )}
              </div>

              {/* Issue #558: AI Guidance controls — sliders for fine-tuning the inpaint run */}
              <details className="rounded-md border border-atelier-taupe/30">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-atelier-primary hover:bg-atelier-canvas select-none">
                  AI Guidance
                </summary>
                <div className="flex flex-col gap-3 px-3 pb-3 pt-1">

                  {/* Prompt Strength: how closely AI follows the text prompt */}
                  <label className="flex items-center gap-2 text-sm text-atelier-primary">
                    <span className="shrink-0">Prompt Strength</span>
                    <input
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={promptStrength}
                      onChange={(e) => setPromptStrength(Number(e.target.value))}
                      aria-label="Prompt Strength"
                      className="w-28"
                    />
                    <span className="w-10 text-right tabular-nums">{promptStrength.toFixed(2)}</span>
                  </label>

                  {/* Mask Blur: feather edges of the mask */}
                  <label className="flex items-center gap-2 text-sm text-atelier-primary">
                    <span className="shrink-0">Mask Blur</span>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      step={1}
                      value={maskBlur}
                      onChange={(e) => setMaskBlur(Number(e.target.value))}
                      aria-label="Mask Blur"
                      className="w-28"
                    />
                    <span className="w-10 text-right tabular-nums">{maskBlur}px</span>
                  </label>

                  {/* Seed: reproducible results */}
                  <div className="flex items-center gap-2 text-sm text-atelier-primary">
                    <label htmlFor={`inpaint-seed-${roomId}`} className="shrink-0">Seed</label>
                    <input
                      id={`inpaint-seed-${roomId}`}
                      type="number"
                      min={0}
                      max={999999}
                      step={1}
                      value={seed ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSeed(val === "" ? undefined : Number(val));
                      }}
                      placeholder="Random"
                      aria-label="Seed for reproducible results"
                      className="w-28 rounded-md border border-atelier-taupe/40 px-2 py-1 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-atelier-primary"
                    />
                    <label htmlFor={`inpaint-lockseed-${roomId}`} className="flex items-center gap-1 text-xs text-atelier-taupe">
                      <input
                        id={`inpaint-lockseed-${roomId}`}
                        type="checkbox"
                        checked={lockSeed}
                        onChange={(e) => setLockSeed(e.target.checked)}
                        className="h-3.5 w-3.5 accent-atelier-primary"
                      />
                      Lock Seed
                    </label>
                  </div>

                  {/* Creative Mode: higher variation */}
                  <div className="flex items-center gap-2 text-sm text-atelier-primary">
                    <span className="shrink-0">Creative Mode</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={creativeMode}
                      aria-label="Creative Mode"
                      onClick={() => setCreativeMode((v) => !v)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-atelier-primary focus:ring-offset-1 ${
                        creativeMode ? "bg-atelier-primary" : "bg-atelier-taupe/40"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          creativeMode ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                </div>
              </details>
            </div>
          </div>

          <div
            role="tabpanel"
            id={editorTabPanelId(tabIdBase, "detect")}
            aria-labelledby={editorTabId(tabIdBase, "detect")}
            hidden={effectiveTab !== "detect"}
          >
            <div className="flex flex-col gap-3">
              {/* Issue #228: concept chips + validated free text. Chips
                  enforce single-concept by construction; free text is
                  validated with isValidConceptName (the server schema's
                  client mirror) BEFORE any billed call is built. */}
              <div className="flex flex-col gap-2">
                  <div
                    role="group"
                    aria-label="Detection concept"
                    aria-busy={conceptLoading}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="font-jakarta text-sm font-medium text-atelier-primary">Concept:</span>
                    {CONCEPT_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        aria-pressed={requestedConcept === chip}
                        disabled={isProcessing}
                        onClick={() => handleConceptChange(chip)}
                        className={
                          requestedConcept === chip
                            ? "px-2.5 py-1 text-xs rounded-full border border-atelier-primary bg-atelier-primary text-white hover:bg-atelier-primary/80 transition-colors"
                            : "px-2.5 py-1 font-jakarta text-xs rounded-full border border-atelier-taupe/40 bg-white text-atelier-primary hover:bg-atelier-canvas transition-colors"
                        }
                      >
                        {chip}
                      </button>
                    ))}
                    {/* Issue #249/#474: bulk selection affordances. Select-all
                        is a pure client-side walk over the decoded
                        instances (zero billed calls); it stops at the
                        batch cap and says so. When detection is running,
                        the button is replaced with a spinner so the
                        disabled state is not confusing (issue #474). */}
                    {conceptLoading ? (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-atelier-primary bg-white text-atelier-taupe">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Detecting {requestedConcept}…
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSelectAllDetected}
                        disabled={
                          isProcessing ||
                          detectedCount === 0 ||
                          selectionCount >= Math.min(detectedCount, MAX_BATCH_OBJECTS)
                        }
                        className="px-2.5 py-1 text-xs rounded-md border border-atelier-primary bg-white text-atelier-primary hover:bg-atelier-canvas transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Select all detected
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleClearSelection}
                      disabled={isProcessing || selectionCount === 0}
                      className="px-2.5 py-1 font-jakarta text-xs rounded-md border border-gray-300 bg-white text-stone-700 hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Clear selection
                    </button>
                  </div>
                  <form onSubmit={handleConceptSubmit} className="flex flex-wrap items-center gap-2">
                    <label htmlFor={conceptInputId} className="text-xs text-stone-600">
                      Custom concept:
                    </label>
                    <input
                      id={conceptInputId}
                      type="text"
                      value={conceptInput}
                      onChange={(event) => {
                        setConceptInput(event.target.value);
                        if (conceptInputError) setConceptInputError(null);
                      }}
                      placeholder="e.g. wall art"
                      className="w-44 rounded-md border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-stone-500"
                    />
                    <button
                      type="submit"
                      disabled={isProcessing}
                      className="px-2.5 py-1 text-xs rounded-md border border-stone-800 bg-white text-stone-800 hover:bg-stone-100 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Detect
                    </button>
                  </form>
                  {conceptInputError && (
                    <p role="alert" className="text-xs font-medium text-red-700">
                      {conceptInputError}
                    </p>
                  )}
                  {conceptLoading && (
                    <p role="status" className="flex items-center gap-1.5 text-xs text-stone-600">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Looking for {requestedConcept}…
                    </p>
                  )}
                  {!conceptLoading && conceptSegments.status === "failed" && (
                    <div className="flex flex-col gap-1">
                      {conceptSegments.failedReason === "service-unreachable" ? (
                        <>
                          <p role="status" className="text-xs font-medium text-amber-700">
                            We could not reach the detection service. Try the Manual paint tab
                            instead, or try again later.
                          </p>
                          <button
                            type="button"
                            onClick={() => setActiveTab("manual")}
                            className="text-xs text-amber-700 underline hover:text-amber-900"
                          >
                            Paint the area manually instead
                          </button>
                        </>
                      ) : (
                        <p role="status" className="text-xs font-medium text-amber-700">
                          Couldn&apos;t detect &quot;{requestedConcept}&quot; — try again, another
                          concept, or the brush.
                        </p>
                      )}
                    </div>
                  )}
                  {!conceptLoading &&
                    displayedResult &&
                    displayedResult.concept === requestedConcept &&
                    displayedResult.maskDataUrls.length === 0 && (
                      <p role="status" className="text-xs text-stone-600">
                        {buildConceptEmptyMessage(requestedConcept)}
                      </p>
                    )}
                  {selectAllNotice && (
                    <p role="status" className="text-xs text-stone-600">
                      {selectAllNotice}
                    </p>
                  )}
                </div>

              {/* Issue #203 panel, fed since #229 by the concept toggles:
                  appears once at least one detected instance has been
                  toggled in. Thematic runs go through the shared
                  single-run launcher; per-object plans execute sequentially
                  with per-step progress and a retry affordance. The panel
                  stays mounted across tab switches (hidden, not
                  unmounted), so its prompts never reset (AC-L5). */}
              {batchSelections.length > 0 && (
                <BatchStagingPanel
                  selections={batchSelections}
                  maxObjects={MAX_BATCH_OBJECTS}
                  disabled={isProcessing || conceptLoading}
                  processing={isProcessing}
                  activeBatch={activeBatch}
                  onRun={handleBatchRun}
                  onRetryRemaining={handleBatchRetry}
                  onRemoveLast={handleRemoveLastSelection}
                  onRemoveSelection={handleRemoveSelection}
                  instanceLabels={instanceLabels}
                  aesthetic={aesthetic}
                />
              )}
            </div>
          </div>
          </div>
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

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Issue #560: Zen Mode floating toolbar — shown only when Zen Mode is active */}
      {zenMode && (
        <ZenModeToolbar
          darkBackground={zenDarkBackground}
          onDarkBackgroundChange={setZenDarkBackground}
        >
          {/* Tool buttons */}
          <div role="group" aria-label="Mask tool" className="flex items-center gap-1">
            {(["brush", "fill", "select"] as const).map((tool) => (
              <button
                key={tool}
                type="button"
                aria-pressed={zenActiveTool === tool}
                aria-label={tool === "brush" ? "Brush" : tool === "fill" ? "Fill Region" : "Select Regions"}
                onClick={() => setZenActiveTool(tool)}
                className={
                  zenActiveTool === tool
                    ? "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-stone-800 text-white transition-colors"
                    : "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-stone-100 text-stone-600 transition-colors hover:bg-stone-200"
                }
              >
                {tool === "brush" ? "Brush" : tool === "fill" ? "Fill" : "Select"}
              </button>
            ))}
          </div>

          {/* Brush size slider */}
          <label className="flex items-center gap-2 text-xs text-stone-600">
            <span>Size</span>
            <input
              type="range"
              min={1}
              max={100}
              value={zenBrushSize}
              onChange={(e) => setZenBrushSize(Number(e.target.value))}
              className="w-20"
              aria-label="Brush size"
            />
            <span className="w-5 text-right">{zenBrushSize}</span>
          </label>

          {/* Clear mask */}
          <button
            type="button"
            onClick={() => {
              setMaskDataUrl(null);
              setBatchSelections([]);
              setSelectedInstanceIndices([]);
            }}
            className="rounded-full px-3 py-1.5 text-xs text-stone-500 bg-stone-100 hover:bg-stone-200 transition-colors"
            title="Clear mask"
          >
            Clear
          </button>
        </ZenModeToolbar>
      )}
    </div>
  );
}

