"use client";

import { useCallback, useEffect } from "react";
import {
  MousePointer2,
  Brush,
  Eraser,
  Wand2,
  Lasso,
  Pipette,
  Hand,
  Minus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type StudioTool =
  | "select"
  | "brush"
  | "eraser"
  | "smartWand"
  | "lasso"
  | "eyedropper"
  | "pan";

interface BrushToolRailProps {
  activeTool: StudioTool;
  onToolChange: (tool: StudioTool) => void;
}

const tools: { id: StudioTool; icon: React.ReactNode; label: string; keyboard: string }[] = [
  { id: "select", icon: <MousePointer2 className="h-4 w-4" aria-hidden="true" />, label: "Select", keyboard: "V" },
  { id: "brush", icon: <Brush className="h-4 w-4" aria-hidden="true" />, label: "Brush Mask", keyboard: "B" },
  { id: "eraser", icon: <Eraser className="h-4 w-4" aria-hidden="true" />, label: "Eraser", keyboard: "E" },
  { id: "smartWand", icon: <Wand2 className="h-4 w-4" aria-hidden="true" />, label: "Smart Wand", keyboard: "W" },
  { id: "lasso", icon: <Lasso className="h-4 w-4" aria-hidden="true" />, label: "Lasso", keyboard: "L" },
  { id: "eyedropper", icon: <Pipette className="h-4 w-4" aria-hidden="true" />, label: "Eyedropper", keyboard: "I" },
];

const bottomTools: { id: StudioTool; icon: React.ReactNode; label: string; keyboard: string }[] = [
  { id: "pan", icon: <Hand className="h-4 w-4" aria-hidden="true" />, label: "Pan", keyboard: "H" },
];

export default function BrushToolRail({ activeTool, onToolChange }: BrushToolRailProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toUpperCase();
      const allTools = [...tools, ...bottomTools];
      const tool = allTools.find((t) => t.keyboard === key);
      if (tool) {
        e.preventDefault();
        onToolChange(tool.id);
      }
    },
    [onToolChange]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="fixed left-3 top-1/2 z-50 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-white/20 bg-white/80 backdrop-blur-xl px-2 py-3 shadow-xl shadow-black/10"
      role="toolbar"
      aria-label="Brush tool rail"
    >
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          aria-pressed={activeTool === tool.id}
          aria-label={`${tool.label} (${tool.keyboard})`}
          title={`${tool.label} (${tool.keyboard})`}
          onClick={() => onToolChange(tool.id)}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl transition-all",
            activeTool === tool.id
              ? "bg-atelier-primary text-white shadow-md"
              : "text-stone-500 hover:bg-stone-100 hover:text-stone-700"
          )}
        >
          {tool.icon}
        </button>
      ))}

      <div className="my-1.5 h-px w-8 bg-stone-200" aria-hidden="true" />

      {bottomTools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          aria-pressed={activeTool === tool.id}
          aria-label={`${tool.label} (${tool.keyboard})`}
          title={`${tool.label} (${tool.keyboard})`}
          onClick={() => onToolChange(tool.id)}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl transition-all",
            activeTool === tool.id
              ? "bg-atelier-primary text-white shadow-md"
              : "text-stone-500 hover:bg-stone-100 hover:text-stone-700"
          )}
        >
          {tool.icon}
        </button>
      ))}
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
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
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
        <span className="label-sm text-stone-600">{label}</span>
        <span className="font-mono text-xs text-stone-500">
          {value}
          {unit}
        </span>
      </div>
      <input
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
  const cardWidth = 240;

  return (
    <div
      className="fixed left-[72px] top-1/2 z-40 w-60 -translate-y-1/2 rounded-2xl border border-white/20 bg-white/80 backdrop-blur-xl p-4 shadow-xl shadow-black/10"
      role="dialog"
      aria-label="Brush Dynamics"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="title-sm font-semibold text-stone-800">Brush Dynamics</h3>
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
        className="mb-5 flex flex-col items-center justify-center"
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
        <span className="mt-2 font-mono text-headline-sm text-stone-700">
          {radius} px
        </span>
      </div>

      <div className="mb-4 space-y-3">
        <Slider
          label="Radius"
          value={radius}
          min={1}
          max={200}
          unit="px"
          onChange={onRadiusChange}
        />
        <Slider
          label="Edge Softness"
          value={edgeSoftness}
          min={0}
          max={100}
          unit="%"
          onChange={onEdgeSoftnessChange}
        />
        <Slider
          label="Mask Opacity"
          value={maskOpacity}
          min={0}
          max={100}
          unit="%"
          onChange={onMaskOpacityChange}
        />
      </div>

      <div className="mb-4 flex items-center justify-center gap-2">
        {BRUSH_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              onRadiusChange(preset.radius);
              onEdgeSoftnessChange(preset.edgeSoftness);
              onMaskOpacityChange(preset.maskOpacity);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-xs font-medium text-stone-600 shadow-sm transition-all hover:border-atelier-primary hover:bg-atelier-primary/5 hover:text-atelier-primary"
            aria-label={`Preset ${preset.label}: radius ${preset.radius}px, softness ${preset.edgeSoftness}%, opacity ${preset.maskOpacity}%`}
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
