"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  Maximize,
  Minimize,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sliderFillStyle } from "@/lib/precision-slider";
import { saveRoomMetadata } from "@/app/actions/room";
import BrushToolRail, {
  BrushParameterFlyout,
} from "@/components/canvas/BrushToolRail";
import GeneratedVariationGrid, {
  type GeneratedVariation,
} from "@/components/canvas/generated-variation-grid";
import InspectorCollapsedRail from "@/components/canvas/inspector-collapsed-rail";
import SplitComparisonCanvas, {
  type SplitComparisonVersion,
} from "@/components/canvas/split-comparison-canvas";
import { StudioWorkflowStepper } from "@/components/dashboard/studio-workflow-stepper";
import {
  INSPECTOR_PANEL_WIDTH_PX,
  INSPECTOR_RAIL_LABEL,
  resolveInspectorPanelView,
  resolveInspectorRailTarget,
  resolveInspectorShortcut,
  type InspectorRailTargetMode,
} from "@/lib/inspector-panel";
import { isTypingTarget, type StudioTool } from "@/lib/tool-rail";
import {
  activeVersionId,
  canRedoSplitHistory,
  canUndoSplitHistory,
  nextSplitHistory,
  type SplitHistoryState,
} from "@/lib/split-comparison-canvas";
import { BRUSH_FLYOUT_SLIDERS } from "@/lib/tool-rail";

/** Inspector mode tab strip labels (mirrors the operation-mode ids). */
const INSPECTOR_MODE_TABS: readonly { id: InspectorRailTargetMode; label: string }[] =
  [
    { id: "inpaint-zone", label: "Inpaint Zone" },
    { id: "restore-original", label: "Restore" },
    { id: "relight", label: "Relight" },
    { id: "material-swap", label: "Material Swap" },
  ];

interface RefineRoom {
  id: string;
  name: string;
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  afterImageUrl2: string | null;
  selectedVariantIndex: number | null;
  rawDirectives: string | null;
  /** Completed inpaint passes, NEWEST first (server ordering). */
  completedRequestIds: string[];
  variations: { id: string; resultUrl: string }[];
}

interface RefineStudioClientProps {
  projectId: string;
  propertyAddress: string;
  initialRoomId: string | null;
  rooms: RefineRoom[];
}

function historyFromRoom(room: RefineRoom | undefined): SplitHistoryState {
  if (!room || room.completedRequestIds.length === 0) {
    return { order: [], cursor: -1 };
  }
  // History walks earliest → latest; the server hands us newest → oldest.
  const order = [...room.completedRequestIds].reverse();
  return { order, cursor: order.length - 1 };
}

/**
 * Step 3 — Brush Refinement Studio (issue #612).
 *
 * Composes the sibling Step-3 components: the collapsible header with
 * room switcher pill + breadcrumb, the floating glassmorphic tool rail
 * (issue #616) with its brush parameter flyout (issue #627), the split
 * before/after comparison canvas with draggable divider + version
 * history pills + undo/redo (issue #618 — this host owns the history
 * state via `nextSplitHistory`, mapping passes to InpaintRequest
 * results), and the collapsible 380px right inspector panel (issue #617)
 * with mode tabs, prompt editor, AI guidance sliders, and the generated
 * variation grid. Keyboard: Cmd/Ctrl+B toggles the inspector, F toggles
 * Focus Canvas Mode (collapses BOTH header and inspector; the floating
 * restore pill is the way back) — classified by
 * `resolveInspectorShortcut` (issue #617/#638).
 */
export function RefineStudioClient({
  projectId,
  propertyAddress,
  initialRoomId,
  rooms,
}: RefineStudioClientProps) {
  const router = useRouter();

  const [activeRoomId, setActiveRoomId] = useState<string | null>(initialRoomId);
  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? null,
    [rooms, activeRoomId]
  );

  // Header + panel chrome state
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  // Tool rail + brush dynamics state
  const [activeTool, setActiveTool] = useState<StudioTool>("brush");
  const [flyoutOpen, setFlyoutOpen] = useState(true);
  const brushDefaults = useMemo(
    () =>
      Object.fromEntries(
        BRUSH_FLYOUT_SLIDERS.map((spec) => [spec.key, spec.defaultValue])
      ) as Record<
        (typeof BRUSH_FLYOUT_SLIDERS)[number]["key"],
        number
      >,
    []
  );
  const [brushParams, setBrushParams] = useState(brushDefaults);

  // Inspector state
  const [activeMode, setActiveMode] = useState<InspectorRailTargetMode>(
    "inpaint-zone"
  );
  const [prompt, setPrompt] = useState(activeRoom?.rawDirectives ?? "");
  const [guidance, setGuidance] = useState(75);
  const [promptStrength, setPromptStrength] = useState(60);

  // Version history — this host owns the reducer state (issue #618).
  const [history, setHistory] = useState<SplitHistoryState>(() =>
    historyFromRoom(
      rooms.find((room) => room.id === initialRoomId) ?? undefined
    )
  );

  const switchRoom = useCallback(
    (roomId: string) => {
      setActiveRoomId(roomId);
      setHistory(historyFromRoom(rooms.find((room) => room.id === roomId)));
      setPrompt(rooms.find((room) => room.id === roomId)?.rawDirectives ?? "");
    },
    [rooms]
  );

  // Keyboard: Cmd/Ctrl+B → inspector toggle; bare F → Focus Canvas Mode
  // (never while typing). Classified by the pinned lib resolver.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveInspectorShortcut({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        isTextEntry: isTypingTarget(event.target),
      });
      if (action === "toggle-inspector") {
        event.preventDefault();
        setInspectorCollapsed((prev) => !prev);
      } else if (action === "toggle-focus-mode") {
        event.preventDefault();
        setFocusMode((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const inspectorView = resolveInspectorPanelView({
    inspectorCollapsed,
    focusMode,
    zenMode: false,
  });

  const variationById = useMemo(() => {
    const map = new Map<string, string>();
    for (const room of rooms) {
      for (const variation of room.variations) {
        map.set(variation.id, variation.resultUrl);
      }
    }
    return map;
  }, [rooms]);

  const currentVersionId = activeVersionId(history);
  const fallbackAfter =
    activeRoom === null
      ? null
      : activeRoom.selectedVariantIndex === 1
        ? activeRoom.afterImageUrl2
        : activeRoom.afterImageUrl;
  const afterImageUrl =
    (currentVersionId ? variationById.get(currentVersionId) : undefined) ??
    fallbackAfter ??
    activeRoom?.variations[0]?.resultUrl ??
    null;

  const variations: GeneratedVariation[] = useMemo(
    () =>
      (activeRoom?.variations ?? []).map((variation) => ({
        id: variation.id,
        thumbnailUrl: variation.resultUrl,
        resultUrl: variation.resultUrl,
        seed: null,
        guidance: null,
        strength: null,
        generationTime: null,
      })),
    [activeRoom]
  );

  const versions: SplitComparisonVersion[] = useMemo(
    () => history.order.map((id) => ({ id })),
    [history.order]
  );

  const handleInspectorRailExpand = useCallback(
    (actionId: Parameters<typeof resolveInspectorRailTarget>[0]) => {
      setInspectorCollapsed(false);
      const target = resolveInspectorRailTarget(actionId);
      if (target.operationMode) {
        setActiveMode(target.operationMode);
      }
    },
    []
  );

  const persistPrompt = useCallback(
    (roomId: string, value: string) => {
      if ((activeRoom?.rawDirectives ?? "") !== value) {
        void saveRoomMetadata(roomId, { rawDirectives: value });
      }
    },
    [activeRoom]
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-surface-container-low">
      {/* ── Collapsible header ───────────────────────────────────────── */}
      {focusMode ? null : headerCollapsed ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant/30 bg-surface-container-lowest/95 px-4 py-1.5 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setHeaderCollapsed(false)}
            aria-label="Expand header"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-container-low hover:text-foreground"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="truncate text-sm font-medium text-foreground font-jakarta">
            {activeRoom?.name ?? "Brush Refinement Studio"}
          </span>
        </div>
      ) : (
        <header className="shrink-0 border-b border-outline-variant/30 bg-surface-container-lowest/95 px-6 py-3 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <nav
                aria-label="Breadcrumb"
                className="flex items-center gap-1 text-sm text-muted-foreground"
              >
                <Link
                  href={`/projects/${projectId}`}
                  className="hover:text-foreground"
                >
                  {propertyAddress}
                </Link>
                <span aria-hidden="true">/</span>
                <span className="text-foreground">{activeRoom?.name ?? "—"}</span>
              </nav>

              {/* Room switcher pill */}
              <label className="inline-flex items-center gap-2 rounded-full border border-outline-variant/40 bg-surface-container-lowest px-3 py-1">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground font-jakarta">
                  Room
                </span>
                <select
                  value={activeRoomId ?? ""}
                  onChange={(e) => switchRoom(e.target.value)}
                  aria-label="Switch room"
                  className="bg-transparent text-sm font-medium text-foreground focus:outline-none"
                >
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <StudioWorkflowStepper
                projectId={projectId}
                activeStep="refine"
                className="hidden lg:block"
              />
              <button
                type="button"
                onClick={() => setInspectorCollapsed((prev) => !prev)}
                aria-label={
                  inspectorCollapsed
                    ? "Expand inspector panel (Cmd+B)"
                    : "Collapse inspector panel (Cmd+B)"
                }
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest text-muted-foreground transition-colors hover:text-foreground"
              >
                {inspectorCollapsed ? (
                  <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setFocusMode(true)}
                aria-label="Enter Focus Canvas Mode (F)"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest text-muted-foreground transition-colors hover:text-foreground"
              >
                <Maximize className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setHeaderCollapsed(true)}
                aria-label="Collapse header"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>
      )}

      {/* ── Studio body ──────────────────────────────────────────────── */}
      <div className="relative flex min-h-0 flex-1">
        {/* Left floating tool rail + brush flyout (issue #616/#627) */}
        {!focusMode && (
          <div className="absolute left-4 top-4 z-20 flex flex-col gap-3">
            <BrushToolRail
              activeTool={activeTool}
              onToolChange={(tool) => {
                setActiveTool(tool);
                if (tool === "brush") setFlyoutOpen(true);
              }}
            />
            {flyoutOpen && (
              <BrushParameterFlyout
                radius={brushParams.radius}
                edgeSoftness={brushParams.edgeSoftness}
                maskOpacity={brushParams.maskOpacity}
                onRadiusChange={(value) =>
                  setBrushParams((prev) => ({ ...prev, radius: value }))
                }
                onEdgeSoftnessChange={(value) =>
                  setBrushParams((prev) => ({ ...prev, edgeSoftness: value }))
                }
                onMaskOpacityChange={(value) =>
                  setBrushParams((prev) => ({ ...prev, maskOpacity: value }))
                }
                onClose={() => setFlyoutOpen(false)}
              />
            )}
          </div>
        )}

        {/* Center canvas — split before/after with draggable divider */}
        <div className="flex min-w-0 flex-1 items-center justify-center p-6 pl-24">
          {activeRoom?.beforeImageUrl && afterImageUrl ? (
            <SplitComparisonCanvas
              className="max-h-full"
              beforeImageUrl={activeRoom.beforeImageUrl}
              beforeAlt={`${activeRoom.name} — vacant`}
              afterImageUrl={afterImageUrl}
              afterAlt={`${activeRoom.name} — staged refinement`}
              beforeLabel="Before"
              afterLabel="After — Brush Refinement"
              versions={versions}
              activeVersionId={currentVersionId}
              onSelectVersion={(id) =>
                setHistory((prev) => nextSplitHistory(prev, { type: "select", id }))
              }
              canUndo={canUndoSplitHistory(history)}
              canRedo={canRedoSplitHistory(history)}
              onUndo={() =>
                setHistory((prev) => nextSplitHistory(prev, { type: "undo" }))
              }
              onRedo={() =>
                setHistory((prev) => nextSplitHistory(prev, { type: "redo" }))
              }
              onReset={() =>
                setHistory((prev) => nextSplitHistory(prev, { type: "reset" }))
              }
            />
          ) : (
            <div className="max-w-md rounded-xl border border-dashed border-outline-variant/50 bg-surface-container-lowest p-8 text-center">
              <h2 className="font-playfair text-xl font-semibold text-foreground">
                Nothing to refine yet
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {activeRoom?.beforeImageUrl
                  ? "This room has no staged result to refine. Run a staging pass from the project editor, then return here."
                  : "This room has no before photo. Upload one from the project page, then return here."}
              </p>
              <Link
                href={`/projects/${projectId}`}
                className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-secondary"
              >
                Open project editor
              </Link>
            </div>
          )}
        </div>

        {/* ── Right inspector column ───────────────────────────────── */}
        {inspectorView === "rail" && (
          <div className="z-10 shrink-0 border-l border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-md">
            <InspectorCollapsedRail onExpand={handleInspectorRailExpand} />
          </div>
        )}

        {inspectorView === "expanded" && (
          <aside
            aria-label="Active inpaint inspector"
            className="z-10 flex shrink-0 flex-col overflow-y-auto border-l border-outline-variant/30 bg-surface-container-lowest/95 backdrop-blur-md"
            style={{ width: INSPECTOR_PANEL_WIDTH_PX }}
          >
            <div className="flex items-center justify-between border-b border-outline-variant/30 px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground font-jakarta">
                {INSPECTOR_RAIL_LABEL}
              </h2>
              <button
                type="button"
                onClick={() => setInspectorCollapsed(true)}
                aria-label="Collapse inspector (Cmd+B)"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-container-low hover:text-foreground"
              >
                <PanelRightClose className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Inpaint operation mode tabs */}
            <div
              role="tablist"
              aria-label="Inpaint operation mode"
              className="flex flex-wrap gap-1 border-b border-outline-variant/30 px-3 py-2"
            >
              {INSPECTOR_MODE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeMode === tab.id}
                  onClick={() => setActiveMode(tab.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors font-jakarta",
                    activeMode === tab.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-surface-container-low hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Prompt editor */}
            <section aria-label="Prompt editor" className="border-b border-outline-variant/30 p-4">
              <label
                htmlFor="refine-prompt"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground font-jakarta"
              >
                Prompt Editor
              </label>
              <textarea
                id="refine-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onBlur={() => {
                  if (activeRoom) persistPrompt(activeRoom.id, prompt);
                }}
                rows={5}
                placeholder="Refine the staging directives for this pass…"
                className="w-full resize-y rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </section>

            {/* AI guidance sliders */}
            <section
              aria-label="AI guidance parameters"
              className="space-y-4 border-b border-outline-variant/30 p-4"
            >
              {(
                [
                  { label: "AI Guidance", value: guidance, onChange: setGuidance },
                  {
                    label: "Prompt Strength",
                    value: promptStrength,
                    onChange: setPromptStrength,
                  },
                ] as const
              ).map((slider) => (
                <div key={slider.label} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs font-medium text-muted-foreground font-jakarta">
                    <span>{slider.label}</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {slider.value}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={slider.value}
                    onChange={(e) => slider.onChange(Number(e.target.value))}
                    className="atelier-slider w-full"
                    style={sliderFillStyle(slider.value, 0, 100)}
                    aria-label={slider.label}
                  />
                </div>
              ))}
            </section>

            {/* Generated variation grid */}
            <section aria-label="Generated variations" className="p-4">
              <GeneratedVariationGrid
                roomName={activeRoom?.name ?? "Room"}
                variations={variations}
                selectedId={currentVersionId}
                isGenerating={false}
                generationProgress=""
                onSelect={(id) =>
                  setHistory((prev) =>
                    nextSplitHistory(prev, { type: "select", id })
                  )
                }
                onGenerateMore={() => router.push(`/projects/${projectId}`)}
                onUse={(variation) =>
                  setHistory((prev) =>
                    nextSplitHistory(prev, {
                      type: "select",
                      id: variation.id,
                    })
                  )
                }
              />
            </section>
          </aside>
        )}

        {/* Focus Canvas Mode restore pill — the only affordance back */}
        {focusMode && (
          <button
            type="button"
            onClick={() => setFocusMode(false)}
            className="absolute bottom-6 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-outline-variant/40 bg-surface-container-lowest/90 px-4 py-2 text-sm font-medium text-foreground shadow-lg backdrop-blur-md transition-colors hover:bg-surface-container-low"
          >
            <Minimize className="h-4 w-4" aria-hidden="true" />
            Exit Focus Canvas Mode (F)
          </button>
        )}
      </div>
    </div>
  );
}
