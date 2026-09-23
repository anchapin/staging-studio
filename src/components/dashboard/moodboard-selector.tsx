"use client";

import { useState } from "react";
import { Check, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_MOODBOARD_THEME_ID,
  MOODBOARD_MICRO_PARAMETERS,
  MOODBOARD_THEMES,
  NEURAL_STAGING_ENGINE_LABEL,
  formatActiveThemeCount,
  moodboardCardClasses,
  themeImageGradient,
  themeStatusLabel,
  type MoodboardTheme,
  type MoodboardThemeId,
} from "@/lib/moodboard-themes";
import { sliderFillStyle } from "@/lib/precision-slider";

function MoodboardThemeCard({
  theme,
  isActive,
  disabled,
  onSelect,
}: {
  theme: MoodboardTheme;
  isActive: boolean;
  disabled: boolean;
  onSelect: (id: MoodboardThemeId) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      aria-label={`${theme.name} — ${theme.directive}`}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      onClick={() => onSelect(theme.id)}
      className={cn(
        moodboardCardClasses(isActive),
        disabled && "pointer-events-none opacity-60"
      )}
    >
      {/* Image area — full-bleed palette-derived treatment, zooms on hover */}
      <div className="relative h-44">
        <div
          role="img"
          aria-label={theme.imageAlt}
          className="absolute inset-0 transition-transform duration-300 ease-out group-hover:scale-105"
          style={{ background: themeImageGradient(theme.palette) }}
        />
        {/* Gradient overlay with directive label pill */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 pb-3 pt-8">
          <span className="inline-flex items-center rounded-full bg-black/30 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider text-white backdrop-blur-sm">
            {theme.directive}
          </span>
        </div>
        {/* Active checkmark badge */}
        {isActive && (
          <span
            className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-secondary shadow-sm"
            aria-hidden="true"
          >
            <Check className="h-3.5 w-3.5 text-secondary-foreground" />
          </span>
        )}
      </div>

      {/* Content area */}
      <div className="p-4">
        <h3 className="font-playfair text-xl font-semibold text-foreground">
          {theme.name}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground line-clamp-2">
          {theme.description}
        </p>
        <div className="mt-3 flex items-center gap-2">
          {theme.palette.map((chip) => (
            <span
              key={chip.hex}
              title={chip.name}
              className="h-5 w-5 rounded-full border border-black/10 shadow-sm"
              style={{ backgroundColor: chip.hex }}
            >
              <span className="sr-only">{chip.name}</span>
            </span>
          ))}
          <span className="flex-1" />
          {isActive ? (
            <span className="text-xs font-semibold uppercase tracking-wider text-secondary">
              {themeStatusLabel(true)}
            </span>
          ) : (
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              {themeStatusLabel(false)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function MicroParameterSlider({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span
          className="font-jakarta text-xs font-medium text-muted-foreground"
        >
          {label}
        </span>
        <span className="font-mono text-xs tabular-nums text-foreground">
          {value}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="atelier-slider w-full accent-secondary disabled:cursor-not-allowed disabled:opacity-50"
        style={sliderFillStyle(value, 0, 100)}
        aria-label={label}
      />
    </div>
  );
}

export interface MoodboardSelectorProps {
  /** Theme selected on mount (Theme 1, Warm Organic Modern, by default). */
  defaultSelectedThemeId?: MoodboardThemeId | null;
  /** Called when a theme card is selected. */
  onSelect?: (id: MoodboardThemeId) => void;
  /** Initial value for the Architectural Preservation Strictness slider. */
  defaultPreservationStrictness?: number;
  /** Initial value for the Generative Foliage & Organic Fill slider. */
  defaultFoliageFill?: number;
  /** Called when either AI Micro-Parameter slider changes. */
  onMicroParameterChange?: (parameters: {
    preservationStrictness: number;
    foliageFill: number;
  }) => void;
  /** Whether the selector is disabled. */
  disabled?: boolean;
  className?: string;
}

export function MoodboardSelector({
  defaultSelectedThemeId = DEFAULT_MOODBOARD_THEME_ID,
  onSelect,
  defaultPreservationStrictness = MOODBOARD_MICRO_PARAMETERS.preservationStrictness.defaultValue,
  defaultFoliageFill = MOODBOARD_MICRO_PARAMETERS.foliageFill.defaultValue,
  onMicroParameterChange,
  disabled = false,
  className,
}: MoodboardSelectorProps) {
  const [selectedThemeId, setSelectedThemeId] = useState<
    MoodboardThemeId | null
  >(defaultSelectedThemeId);
  const [preservationStrictness, setPreservationStrictness] = useState(
    defaultPreservationStrictness
  );
  const [foliageFill, setFoliageFill] = useState(defaultFoliageFill);

  const handleSelect = (id: MoodboardThemeId) => {
    setSelectedThemeId(id);
    onSelect?.(id);
  };

  const handlePreservationChange = (value: number) => {
    setPreservationStrictness(value);
    onMicroParameterChange?.({
      preservationStrictness: value,
      foliageFill,
    });
  };

  const handleFoliageChange = (value: number) => {
    setFoliageFill(value);
    onMicroParameterChange?.({
      preservationStrictness,
      foliageFill: value,
    });
  };

  const activeCount = selectedThemeId === null ? 0 : 1;

  return (
    <section
      className={cn("flex flex-col gap-5", className)}
      aria-label="Staging aesthetic moodboard and materiality"
    >
      {/* Active theme counter badge */}
      <div>
        <span className="inline-flex items-center rounded-full bg-secondary-fixed/50 px-3 py-1 text-xs font-medium text-secondary">
          {formatActiveThemeCount(activeCount)}
        </span>
      </div>

      {/* 2-column bento grid of theme cards */}
      <div
        role="radiogroup"
        aria-label="Staging aesthetic moodboard"
        className="grid grid-cols-1 gap-5 md:grid-cols-2"
      >
        {MOODBOARD_THEMES.map((theme) => (
          <MoodboardThemeCard
            key={theme.id}
            theme={theme}
            isActive={selectedThemeId === theme.id}
            disabled={disabled}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* AI Micro-Parameter subpanel */}
      <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span
            className="font-jakarta text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            AI Micro-Parameters
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/40 bg-card px-2.5 py-0.5 font-mono text-xs text-muted-foreground">
            <Cpu className="h-3 w-3" aria-hidden="true" />
            {NEURAL_STAGING_ENGINE_LABEL}
          </span>
        </div>
        <div className="flex flex-col gap-5">
          <MicroParameterSlider
            label={MOODBOARD_MICRO_PARAMETERS.preservationStrictness.label}
            value={preservationStrictness}
            disabled={disabled}
            onChange={handlePreservationChange}
          />
          <MicroParameterSlider
            label={MOODBOARD_MICRO_PARAMETERS.foliageFill.label}
            value={foliageFill}
            disabled={disabled}
            onChange={handleFoliageChange}
          />
        </div>
      </div>
    </section>
  );
}
