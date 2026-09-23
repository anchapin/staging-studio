"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MousePointer2,
  Brush,
  Eraser,
  Wand2,
  Lasso,
  Pipette,
  Hand,
  X,
  Minus,
  Plus,
  Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TOOL_RAIL_TOOLS,
  TOOL_RAIL_SURFACE_CLASSES,
  TOOL_RAIL_ACTIVE_CLASSES,
  TOOL_RAIL_ACTIVE_TICK_CLASSES,
  TOOL_RAIL_DIVIDER_CLASSES,
  BRUSH_FLYOUT_SLIDERS,
  ZOOM_FIT,
  clampZoom,
  formatZoomPercent,
  isTypingTarget,
  matchToolByKey,
  type StudioTool,
} from "@/lib/tool-rail";

export type { StudioTool };

interface BrushToolRailProps {
  activeTool: StudioTool;
  onToolChange: (tool: StudioTool) => void;
}

/** lucide equivalents of the Material Symbols icons in the Stitch design. */
const TOOL_ICONS: Record<StudioTool, React.ReactNode> = {
  select: <MousePointer2 className="h-4 w-4" aria-hidden="true" />,
  brush: <Brush className="h-4 w-4" aria-hidden="true" />,
  eraser: <Eraser className="h-4 w-4" aria-hidden="true" />,
  smartWand: <Wand2 className="h-4 w-4" aria-hidden="true" />,
  lasso: <Lasso className="h-4 w-4" aria-hidden="true" />,
  eyedropper: <Pipette className="h-4 w-4" aria-hidden="true" />,
  pan: <Hand className="h-4 w-4" aria-hidden="true" />,
};

/**
 * Floating glassmorphic tool rail strip (issue #616).
 *
 * Renders the 7 tool buttons (Select V, Brush B, Eraser E, Smart Wand W,
 * Lasso L, Eyedropper I, divider, Pan H/Space) with the frosted
 * `surface-container-lowest`/90 + `backdrop-blur-md` treatment. Positioning
 * is left to the parent stack (`fixed left-6 top-6` in the inpaint editor)
 * so the brush flyout card and zoom HUD stack directly below it.
 */
export default function BrushToolRail({ activeTool, onToolChange }: BrushToolRailProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const tool = matchToolByKey(e.key, activeTool);
      if (tool) {
        e.preventDefault();
        onToolChange(tool);
      }
    },
    [activeTool, onToolChange]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const renderToolButton = (tool: (typeof TOOL_RAIL_TOOLS)[number]) => {
    const isActive = activeTool === tool.id;
    return (
      <button
        key={tool.id}
        type="button"
        aria-pressed={isActive}
        aria-label={`${tool.label} (${tool.keyboard})`}
        title={`${tool.label} (${tool.keyboard})`}
        onClick={() => onToolChange(tool.id)}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-md transition-all",
          isActive
            ? TOOL_RAIL_ACTIVE_CLASSES
            : "text-stone-500 hover:bg-stone-100 hover:text-stone-700"
        )}
      >
        {TOOL_ICONS[tool.id]}
        {tool.aiBadge && (
          <span
            className="absolute -right-1 -top-1 rounded-full bg-atelier-secondary px-1 text-[8px] font-bold leading-3 tracking-wide text-white"
            aria-hidden="true"
          >
            AI
          </span>
        )}
        {isActive && (
          <span
            className={cn(
              "absolute -bottom-1 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full",
              TOOL_RAIL_ACTIVE_TICK_CLASSES
            )}
            aria-hidden="true"
          />
        )}
      </button>
    );
  };

  return (
    <div
      className={cn("flex flex-col items-center gap-1 px-2 py-2.5", TOOL_RAIL_SURFACE_CLASSES)}
      role="toolbar"
      aria-label="Canvas tool rail"
      aria-orientation="vertical"
    >
      {TOOL_RAIL_TOOLS.filter((tool) => tool.group === "main").map(renderToolButton)}

      <div className={cn("my-1.5", TOOL_RAIL_DIVIDER_CLASSES)} aria-hidden="true" />

      {TOOL_RAIL_TOOLS.filter((tool) => tool.group === "navigation").map(renderToolButton)}
    </div>
  );
}

interface BrushParameterFlyoutProps {
  radius: number;
  edgeSoftness: number;
  maskOpacity: number;
  onRadiusChange: (value: number) => void;
  onEdgeSoftnessChange: (value: number) => void;
  onMaskOpacityChange: (value: number) => void;
  onClose: () => void;
}

const BRUSH_PRESETS = [
  { label: "S", radius: 8, edgeSoftness: 20, maskOpacity: 60 },
  { label: "M", radius: 42, edgeSoftness: 35, maskOpacity: 80 },
  { label: "L", radius: 100, edgeSoftness: 50, maskOpacity: 90 },
];

function Slider({
  id,
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-stone-600">{label}</span>
        <span className="rounded-sm bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-600">
          {value}
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="atelier-slider w-full"
        aria-label={`${label}: ${value}${unit}`}
      />
    </div>
  );
}

/**
 * Collapsible Brush Dynamics flyout card (issue #616), rendered directly
 * below the tool strip: 224px (w-56) glassmorphic card with the current
 * size in JetBrains Mono and the three spec sliders (custom
 * `.atelier-slider` range styling).
 */
export function BrushParameterFlyout({
  radius,
  edgeSoftness,
  maskOpacity,
  onRadiusChange,
  onEdgeSoftnessChange,
  onMaskOpacityChange,
  onClose,
}: BrushParameterFlyoutProps) {
  const previewSize = Math.min(radius * 1.5, 80);
  const sliderValues = { radius, edgeSoftness, maskOpacity } as const;
  const sliderHandlers = {
    radius: onRadiusChange,
    edgeSoftness: onEdgeSoftnessChange,
    maskOpacity: onMaskOpacityChange,
  } as const;

  return (
    <div
      className={cn("w-56 p-4", TOOL_RAIL_SURFACE_CLASSES)}
      role="dialog"
      aria-label="Brush Dynamics"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-800">Brush Dynamics</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close brush parameters"
          className="flex h-6 w-6 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600 transition-colors"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div
        className="mb-4 flex flex-col items-center justify-center"
        style={{ height: previewSize + 20 }}
      >
        <div
          className="rounded-full border-2 border-atelier-primary/40 bg-atelier-primary/10"
          style={{
            width: previewSize,
            height: previewSize,
          }}
          aria-hidden="true"
        />
        <span className="mt-2 font-mono text-sm text-stone-700">{radius} px</span>
      </div>

      <div className="mb-4 space-y-3">
        {BRUSH_FLYOUT_SLIDERS.map((spec) => (
          <Slider
            key={spec.key}
            id={spec.id}
            label={spec.label}
            value={sliderValues[spec.key]}
            min={spec.min}
            max={spec.max}
            unit={spec.unit}
            onChange={sliderHandlers[spec.key]}
          />
        ))}
      </div>

      <div className="mb-3 flex items-center justify-center gap-2">
        {BRUSH_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              onRadiusChange(preset.radius);
              onEdgeSoftnessChange(preset.edgeSoftness);
              onMaskOpacityChange(preset.maskOpacity);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-xs font-medium text-stone-600 shadow-sm transition-all hover:border-atelier-secondary hover:bg-atelier-secondary/5 hover:text-atelier-secondary"
            aria-label={`Preset ${preset.label}: radius ${preset.radius}px, softness ${preset.edgeSoftness}px, opacity ${preset.maskOpacity}%`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <p className="text-center font-mono text-[10px] text-stone-400/50">
        Brush: B | Erase: E | Pan: H
      </p>
    </div>
  );
}

interface CanvasZoomHudProps {
  /** Controlled zoom percentage; omit to let the HUD manage its own state. */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
}

/**
 * Zoom HUD pill (issue #616) rendered below the flyout card:
 * minus / plus / fit-screen buttons and the current zoom percentage in
 * JetBrains Mono, sharing the rail's glassmorphic surface.
 */
export function CanvasZoomHud({ zoom: controlledZoom, onZoomChange }: CanvasZoomHudProps) {
  const [internalZoom, setInternalZoom] = useState(ZOOM_FIT);
  const zoom = controlledZoom ?? internalZoom;

  const setZoom = useCallback(
    (next: number) => {
      const clamped = clampZoom(next);
      setInternalZoom(clamped);
      onZoomChange?.(clamped);
    },
    [onZoomChange]
  );

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-pill px-2 py-1.5",
        TOOL_RAIL_SURFACE_CLASSES
      )}
      role="group"
      aria-label="Canvas zoom controls"
    >
      <button
        type="button"
        onClick={() => setZoom(clampZoom(zoom - 25))}
        aria-label="Zoom out"
        title="Zoom out"
        className="flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
      >
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span className="min-w-[3.25rem] text-center font-mono text-xs text-stone-700" aria-live="polite">
        {formatZoomPercent(zoom)}
      </span>
      <button
        type="button"
        onClick={() => setZoom(clampZoom(zoom + 25))}
        aria-label="Zoom in"
        title="Zoom in"
        className="flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setZoom(ZOOM_FIT)}
        aria-label="Fit screen (reset zoom to 100%)"
        title="Fit screen"
        className="flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
      >
        <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
