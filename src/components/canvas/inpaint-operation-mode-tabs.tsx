"use client";

import { useId } from "react";
import {
  Crop,
  Lightbulb,
  Layers,
  ArrowLeftRight,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
} from "lucide-react";

import { sliderFillStyle } from "@/lib/precision-slider";

// ---------------------------------------------------------------------------
// Issue #629: Inpaint Operation Mode tabs — a secondary tab strip that switches
// between different AI inpaint operations (Inpaint Zone, Restore Original,
// Relight, Material Swap). Rendered inside the Manual paint panel.
// ---------------------------------------------------------------------------

/** The four inpaint operation modes. */
export type InpaintOperationModeId =
  | "inpaint-zone"
  | "restore-original"
  | "relight"
  | "material-swap";

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
// Light direction options for the Relight mode
// ---------------------------------------------------------------------------

export type LightDirection = "up" | "down" | "left" | "right";

const LIGHT_DIRECTIONS: { id: LightDirection; label: string; icon: React.ReactNode }[] = [
  { id: "up", label: "Top", icon: <ArrowUp className="h-4 w-4" aria-hidden="true" /> },
  { id: "down", label: "Bottom", icon: <ArrowDown className="h-4 w-4" aria-hidden="true" /> },
  { id: "left", label: "Left", icon: <ArrowLeft className="h-4 w-4" aria-hidden="true" /> },
  { id: "right", label: "Right", icon: <ArrowRight className="h-4 w-4" aria-hidden="true" /> },
];

// ---------------------------------------------------------------------------
// Material categories for Material Swap mode
// ---------------------------------------------------------------------------

export type MaterialCategory = "fabric" | "wood" | "stone" | "metal" | "paint";

const MATERIAL_CATEGORIES: { id: MaterialCategory; label: string }[] = [
  { id: "fabric", label: "Fabric" },
  { id: "wood", label: "Wood" },
  { id: "stone", label: "Stone" },
  { id: "metal", label: "Metal" },
  { id: "paint", label: "Paint" },
];

// ---------------------------------------------------------------------------
// Props for InpaintOperationModeTabs
// ---------------------------------------------------------------------------

export interface InpaintOperationModeTabsProps {
  /** Currently active operation mode */
  activeMode: InpaintOperationModeId;
  /** Callback when a mode tab is selected */
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
  // Relight controls
  lightDirection: LightDirection;
  onLightDirectionChange: (d: LightDirection) => void;
  relightIntensity: number;
  onRelightIntensityChange: (v: number) => void;
  relightTemperature: number;
  onRelightTemperatureChange: (v: number) => void;
  // Material Swap controls
  materialCategory: MaterialCategory;
  onMaterialCategoryChange: (c: MaterialCategory) => void;
  onApplyMaterial: (mode: InpaintOperationModeId) => void;
  isApplyingMaterial: boolean;
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
  lightDirection,
  onLightDirectionChange,
  relightIntensity,
  onRelightIntensityChange,
  relightTemperature,
  onRelightTemperatureChange,
  materialCategory,
  onMaterialCategoryChange,
  onApplyMaterial,
  isApplyingMaterial,
}: InpaintOperationModeTabsProps) {
  const idBase = useId();

  return (
    <div className="flex flex-col">
      {/* Tab bar — matches issue #629 styling spec */}
      <div
        role="tablist"
        aria-label="Inpaint operation mode"
        className="flex border-b border-atelier-taupe/40"
      >
        {OPERATION_TABS.map((tab) => {
          const active = tab.id === activeMode;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${idBase}-op-tab-${tab.id}`}
              aria-selected={active}
              aria-controls={`${idBase}-op-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onModeChange(tab.id)}
              className={`flex-1 px-4 py-2.5 text-center title-sm font-semibold transition-colors ${
                active
                  ? "text-atelier-primary bg-atelier-canvas border-b-2 border-atelier-primary"
                  : "text-atelier-taupe bg-transparent hover:bg-atelier-canvas"
              }`}
            >
              <span className="flex flex-col items-center gap-0.5">
                {tab.icon}
                <span className="text-xs">{tab.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Mode description — subtle muted style below tab bar */}
      <p className="px-3 py-2 text-xs text-atelier-taupe bg-atelier-canvas/50">
        {OPERATION_TABS.find((t) => t.id === activeMode)?.description}
      </p>

      {/* Mode-specific control panels — all mounted, hidden/shown */}
      {OPERATION_TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${idBase}-op-panel-${tab.id}`}
          aria-labelledby={`${idBase}-op-tab-${tab.id}`}
          hidden={tab.id !== activeMode}
          className="flex flex-col gap-3 px-1 py-3"
        >
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

          {/* Restore Original: restore buttons */}
          {tab.id === "restore-original" && (
            <>
              <button
                type="button"
                onClick={() => onApplyMaterial(tab.id)}
                disabled={isApplyingMaterial || !hasMask}
                className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                  isApplyingMaterial || !hasMask
                    ? "border-atelier-taupe/40 text-atelier-taupe cursor-not-allowed"
                    : "border-atelier-primary text-atelier-primary hover:bg-atelier-canvas"
                }`}
              >
                {isApplyingMaterial ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Restoring…
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Restore Area
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => onApplyMaterial(tab.id)}
                disabled={isApplyingMaterial}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-atelier-taupe hover:text-atelier-primary hover:bg-atelier-canvas transition-colors"
              >
                Restore All
              </button>
            </>
          )}

          {/* Relight: light direction + intensity + temperature */}
          {tab.id === "relight" && (
            <>
              {/* Light direction selector */}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-atelier-primary">Light Direction</span>
                <div className="flex gap-2 justify-center">
                  {LIGHT_DIRECTIONS.map((dir) => (
                    <button
                      key={dir.id}
                      type="button"
                      aria-pressed={lightDirection === dir.id}
                      aria-label={dir.label}
                      onClick={() => onLightDirectionChange(dir.id)}
                      className={`flex flex-col items-center gap-1 rounded-md border px-3 py-2 text-xs transition-colors ${
                        lightDirection === dir.id
                          ? "border-atelier-primary bg-atelier-primary text-atelier-cream"
                          : "border-atelier-taupe/40 text-atelier-taupe hover:bg-atelier-canvas hover:text-atelier-primary"
                      }`}
                    >
                      {dir.icon}
                      <span>{dir.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Intensity slider */}
              <label className="flex items-center gap-2 text-sm text-atelier-primary">
                <span className="shrink-0 w-24">Intensity</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={relightIntensity}
                  onChange={(e) => onRelightIntensityChange(Number(e.target.value))}
                  aria-label="Light intensity"
                  className="atelier-slider flex-1"
                  style={sliderFillStyle(relightIntensity, 0, 100)}
                />
                <span className="w-10 text-right tabular-nums font-medium text-atelier-taupe">
                  {relightIntensity}%
                </span>
              </label>

              {/* Color temperature slider */}
              <label className="flex items-center gap-2 text-sm text-atelier-primary">
                <span className="shrink-0 w-24">Temperature</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={relightTemperature}
                  onChange={(e) => onRelightTemperatureChange(Number(e.target.value))}
                  aria-label="Color temperature"
                  className="atelier-slider flex-1"
                  style={sliderFillStyle(relightTemperature, 0, 100)}
                />
                <span className="w-14 text-right tabular-nums font-medium text-atelier-taupe text-xs">
                  {relightTemperature < 33
                    ? "Warm"
                    : relightTemperature > 66
                      ? "Cool"
                      : "Neutral"}
                </span>
              </label>

              <button
                type="button"
                onClick={() => onApplyMaterial(tab.id)}
                disabled={isApplyingMaterial || !hasMask}
                className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  isApplyingMaterial || !hasMask
                    ? "bg-atelier-taupe/40 text-atelier-taupe cursor-not-allowed"
                    : "bg-atelier-primary text-atelier-cream hover:bg-atelier-primary/80"
                }`}
              >
                {isApplyingMaterial ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Applying…
                  </>
                ) : (
                  <>
                    <Lightbulb className="h-4 w-4" aria-hidden="true" />
                    Apply Relight
                  </>
                )}
              </button>
            </>
          )}

          {/* Material Swap: category selector + swatches + apply */}
          {tab.id === "material-swap" && (
            <>
              {/* Material category selector */}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-atelier-primary">Material Category</span>
                <div className="flex flex-wrap gap-2">
                  {MATERIAL_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      aria-pressed={materialCategory === cat.id}
                      onClick={() => onMaterialCategoryChange(cat.id)}
                      className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors ${
                        materialCategory === cat.id
                          ? "border-atelier-primary bg-atelier-primary text-atelier-cream"
                          : "border-atelier-taupe/40 text-atelier-taupe hover:bg-atelier-canvas hover:text-atelier-primary"
                      }`}
                    >
                      {materialCategory === cat.id && <Check className="h-3 w-3" aria-hidden="true" />}
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Material sub-selector swatches — placeholder grid */}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-atelier-primary">Select Finish</span>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <button
                      key={i}
                      type="button"
                      aria-label={`Material swatch ${i}`}
                      className={`aspect-square rounded-md border-2 transition-all ${
                        i === 1
                          ? "border-atelier-primary ring-2 ring-atelier-primary/30"
                          : "border-atelier-taupe/30 hover:border-atelier-taupe"
                      }`}
                      style={{
                        backgroundColor: [
                          "#D4A974",
                          "#8B7355",
                          "#C4B49A",
                          "#A89078",
                          "#B8A090",
                          "#9C8B7A",
                          "#C8B8A0",
                          "#A07860",
                        ][i - 1],
                      }}
                    />
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onApplyMaterial(tab.id)}
                disabled={isApplyingMaterial || !hasMask}
                className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  isApplyingMaterial || !hasMask
                    ? "bg-atelier-taupe/40 text-atelier-taupe cursor-not-allowed"
                    : "bg-atelier-primary text-atelier-cream hover:bg-atelier-primary/80"
                }`}
              >
                {isApplyingMaterial ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Applying…
                  </>
                ) : (
                  <>
                    <Layers className="h-4 w-4" aria-hidden="true" />
                    Apply Material
                  </>
                )}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
