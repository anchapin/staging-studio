"use client";

import { useId } from "react";
import {
  Crop,
  Lightbulb,
  ArrowLeftRight,
  RotateCcw,
} from "lucide-react";

import { sliderFillStyle } from "@/lib/precision-slider";
import {
  INPAINT_OPERATION_MODE_AVAILABILITY,
  type InpaintOperationModeId,
} from "@/lib/operation-mode-availability";

// ---------------------------------------------------------------------------
// Issue #629: Inpaint Operation Mode tabs — a secondary tab strip that switches
// between different AI inpaint operations (Inpaint Zone, Restore Original,
// Relight, Material Swap). Rendered inside the Manual paint panel.
//
// Issue #692: only Inpaint Zone is wired to a real endpoint (/api/inpaint).
// The other three modes render as visibly disabled tabs with a "Coming soon"
// badge (see lib/operation-mode-availability.ts) — they cannot be activated,
// fire no handlers, and their panels are inert.
// ---------------------------------------------------------------------------

export type { InpaintOperationModeId };

export interface InpaintOperationModeTab {
  id: InpaintOperationModeId;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const OPERATION_TABS: InpaintOperationModeTab[] = [
  {
    id: "inpaint-zone",
    label: "Inpaint Zone",
    icon: <Crop className="h-4 w-4" aria-hidden="true" />,
    description: "AI analyzes the selected mask region and generates new content",
  },
  {
    id: "restore-original",
    label: "Restore",
    icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
    description: "Revert selected area to the original vacant room photograph",
  },
  {
    id: "relight",
    label: "Relight",
    icon: <Lightbulb className="h-4 w-4" aria-hidden="true" />,
    description: "Adjust the lighting of the selected masked region independently",
  },
  {
    id: "material-swap",
    label: "Material",
    icon: <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />,
    description: "Replace materials in the selected mask with new surface finishes",
  },
];

export { OPERATION_TABS };

// ---------------------------------------------------------------------------
// Props for InpaintOperationModeTabs
// ---------------------------------------------------------------------------

export interface InpaintOperationModeTabsProps {
  /** Currently active operation mode */
  activeMode: InpaintOperationModeId;
  /** Callback when an available mode tab is selected (disabled tabs never fire) */
  onModeChange: (mode: InpaintOperationModeId) => void;
  // Inpaint Zone controls
  strength: number;
  onStrengthChange: (v: number) => void;
  guidanceScale: number;
  onGuidanceScaleChange: (v: number) => void;
  seed: number | undefined;
  onSeedChange: (v: number | undefined) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  hasMask: boolean;
}

// ---------------------------------------------------------------------------
// InpaintOperationModeTabs component
// ---------------------------------------------------------------------------

export default function InpaintOperationModeTabs({
  activeMode,
  onModeChange,
  strength,
  onStrengthChange,
  guidanceScale,
  onGuidanceScaleChange,
  seed,
  onSeedChange,
  onGenerate,
  isGenerating,
  hasMask,
}: InpaintOperationModeTabsProps) {
  const idBase = useId();

  return (
    <div className="flex flex-col">
      {/* Tab bar — matches issue #629 styling spec; issue #692 disables
          unwired modes (Relight / Material / Restore) with a badge */}
      <div
        role="tablist"
        aria-label="Inpaint operation mode"
        className="flex border-b border-atelier-taupe/40"
      >
        {OPERATION_TABS.map((tab) => {
          const active = tab.id === activeMode;
          const availability = INPAINT_OPERATION_MODE_AVAILABILITY[tab.id];
          const modeAvailable = availability?.available ?? false;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${idBase}-op-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`${idBase}-op-panel-${tab.id}`}
              aria-disabled={!modeAvailable}
              tabIndex={active ? 0 : -1}
              disabled={!modeAvailable}
              title={
                modeAvailable ? undefined : `${tab.label} — ${availability?.badge ?? "Coming soon"}`
              }
              onClick={modeAvailable ? () => onModeChange(tab.id) : undefined}
              className={`flex-1 px-4 py-2.5 text-center title-sm font-semibold transition-colors ${
                active
                  ? "text-atelier-primary bg-atelier-canvas border-b-2 border-atelier-primary"
                  : modeAvailable
                    ? "text-atelier-taupe bg-transparent hover:bg-atelier-canvas"
                    : "text-atelier-taupe/50 bg-transparent cursor-not-allowed"
              }`}
            >
              <span className="flex flex-col items-center gap-0.5">
                {tab.icon}
                <span className="text-xs inline-flex items-center gap-1">
                  {tab.label}
                  {!modeAvailable && (
                    <span className="rounded-full border border-atelier-taupe/40 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-atelier-taupe/70">
                      {availability?.badge ?? "Coming soon"}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Mode description — subtle muted style below tab bar */}
      <p className="px-3 py-2 text-xs text-atelier-taupe bg-atelier-canvas/50">
        {OPERATION_TABS.find((t) => t.id === activeMode)?.description}
      </p>

      {/* Mode-specific control panels — all mounted, hidden/shown. Issue #692:
          unwired modes render an inert "coming soon" note, never live controls. */}
      {OPERATION_TABS.map((tab) => {
        const modeAvailable = INPAINT_OPERATION_MODE_AVAILABILITY[tab.id]?.available ?? false;
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${idBase}-op-panel-${tab.id}`}
            aria-labelledby={`${idBase}-op-tab-${tab.id}`}
            hidden={tab.id !== activeMode}
            className="flex flex-col gap-3 px-1 py-3"
          >
            {!modeAvailable ? (
              <p className="px-2 py-4 text-center text-xs text-atelier-taupe">
                {tab.label} — {INPAINT_OPERATION_MODE_AVAILABILITY[tab.id]?.badge ?? "Coming soon"}
                .
                <br />
                <span className="text-atelier-taupe/70">{tab.description}.</span>
              </p>
            ) : (
              <>
                {/* Inpaint Zone: strength, guidance, seed, generate */}
                {tab.id === "inpaint-zone" && (
                  <>
                    {/* Strength slider */}
                    <label className="flex items-center gap-2 text-sm text-atelier-primary">
                      <span className="shrink-0 w-24">Strength</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={strength}
                        onChange={(e) => onStrengthChange(Number(e.target.value))}
                        aria-label="Inpaint strength"
                        className="atelier-slider flex-1"
                        style={sliderFillStyle(strength, 0, 100)}
                      />
                      <span className="w-10 text-right tabular-nums font-medium text-atelier-taupe">
                        {strength}%
                      </span>
                    </label>

                    {/* Guidance scale slider */}
                    <label className="flex items-center gap-2 text-sm text-atelier-primary">
                      <span className="shrink-0 w-24">Guidance</span>
                      <input
                        type="range"
                        min={1}
                        max={20}
                        step={0.5}
                        value={guidanceScale}
                        onChange={(e) => onGuidanceScaleChange(Number(e.target.value))}
                        aria-label="Guidance scale"
                        className="atelier-slider flex-1"
                        style={sliderFillStyle(guidanceScale, 1, 20)}
                      />
                      <span className="w-10 text-right tabular-nums font-medium text-atelier-taupe">
                        {guidanceScale}
                      </span>
                    </label>

                    {/* Seed input */}
                    <div className="flex items-center gap-2 text-sm text-atelier-primary">
                      <label htmlFor={`${idBase}-seed`} className="shrink-0 w-24">
                        Seed
                      </label>
                      <input
                        id={`${idBase}-seed`}
                        type="number"
                        min={0}
                        max={999999}
                        step={1}
                        value={seed ?? ""}
                        onChange={(e) =>
                          onSeedChange(e.target.value === "" ? undefined : Number(e.target.value))
                        }
                        placeholder="Random"
                        aria-label="Seed for reproducible results"
                        className="flex-1 rounded-md border border-atelier-taupe/40 px-2 py-1 text-xs font-jetbrains tabular-nums focus:outline-none focus:ring-2 focus:ring-atelier-primary"
                      />
                    </div>

                    {/* Generate button */}
                    <button
                      type="button"
                      onClick={onGenerate}
                      disabled={isGenerating || !hasMask}
                      title={!hasMask ? "Paint on the image to select the area you want to regenerate" : undefined}
                      className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        isGenerating || !hasMask
                          ? "bg-atelier-taupe/40 text-atelier-taupe cursor-not-allowed"
                          : "bg-atelier-primary text-atelier-cream hover:bg-atelier-primary/80"
                      }`}
                    >
                      {isGenerating ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          Processing…
                        </>
                      ) : (
                        "Generate"
                      )}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
