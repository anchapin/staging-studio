"use client";

import { Brush } from "lucide-react";

interface BrushParameterFlyoutProps {
  brushRadius: number;
  edgeSoftness: number;
  maskOpacity: number;
  onBrushRadiusChange: (v: number) => void;
  onEdgeSoftnessChange: (v: number) => void;
  onMaskOpacityChange: (v: number) => void;
  onClose: () => void;
}

export default function BrushParameterFlyout({
  brushRadius,
  edgeSoftness,
  maskOpacity,
  onBrushRadiusChange,
  onEdgeSoftnessChange,
  onMaskOpacityChange,
  onClose,
}: BrushParameterFlyoutProps) {
  return (
    <div className="fixed left-20 top-1/2 -translate-y-1/2 z-40 bg-white/95 dark:bg-stone-900/95 backdrop-blur-md rounded-xl border border-stone-200 dark:border-stone-700 shadow-xl p-4 w-64">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brush size={14} className="text-stone-500" />
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300 font-jakarta">
            Brush Settings
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 text-xs"
        >
          ✕
        </button>
      </div>

      {/* Brush Radius */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-stone-500 dark:text-stone-400 font-jakarta">Radius</span>
          <span className="text-xs font-mono text-stone-600 dark:text-stone-300 font-jetbrains">
            {brushRadius}px
          </span>
        </div>
        <div className="relative h-1.5 bg-stone-200 dark:bg-stone-700 rounded-full">
          <div
            className="absolute top-0 left-0 h-full bg-stone-800 dark:bg-stone-200 rounded-full"
            style={{ width: `${(brushRadius / 100) * 100}%` }}
          />
        </div>
        <input
          type="range"
          min={2}
          max={100}
          value={brushRadius}
          onChange={(e) => onBrushRadiusChange(Number(e.target.value))}
          className="w-full mt-1 accent-stone-800"
        />
      </div>

      {/* Edge Softness */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-stone-500 dark:text-stone-400 font-jakarta">Edge Softness</span>
          <span className="text-xs font-mono text-stone-600 dark:text-stone-300 font-jetbrains">
            {edgeSoftness}px
          </span>
        </div>
        <div className="relative h-1.5 bg-stone-200 dark:bg-stone-700 rounded-full">
          <div
            className="absolute top-0 left-0 h-full bg-stone-800 dark:bg-stone-200 rounded-full"
            style={{ width: `${(edgeSoftness / 20) * 100}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={20}
          value={edgeSoftness}
          onChange={(e) => onEdgeSoftnessChange(Number(e.target.value))}
          className="w-full mt-1 accent-stone-800"
        />
      </div>

      {/* Mask Opacity */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-stone-500 dark:text-stone-400 font-jakarta">Mask Opacity</span>
          <span className="text-xs font-mono text-stone-600 dark:text-stone-300 font-jetbrains">
            {Math.round(maskOpacity * 100)}%
          </span>
        </div>
        <div className="relative h-1.5 bg-stone-200 dark:bg-stone-700 rounded-full">
          <div
            className="absolute top-0 left-0 h-full bg-stone-800 dark:bg-stone-200 rounded-full"
            style={{ width: `${maskOpacity * 100}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={maskOpacity * 100}
          onChange={(e) => onMaskOpacityChange(Number(e.target.value) / 100)}
          className="w-full mt-1 accent-stone-800"
        />
      </div>
    </div>
  );
}
