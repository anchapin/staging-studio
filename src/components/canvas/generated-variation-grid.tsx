"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, Images } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** One AI-generated variation thumbnail. */
export interface GeneratedVariation {
  id: string;
  /** Thumbnail URL (smaller, for the grid). */
  thumbnailUrl: string;
  /** Full-resolution result URL — used when the user clicks "Use". */
  resultUrl: string;
  /** Seed used for reproducible generation (displayed in metadata). */
  seed: number | null;
  /** Guidance/srompt strength value used (displayed in metadata). */
  guidance: number | null;
  /** Prompt strength used (displayed in metadata). */
  strength: number | null;
  /** How long the generation took in seconds (displayed in metadata). */
  generationTime: number | null;
}

interface GeneratedVariationGridProps {
  /** Room display name — used for descriptive alt text. */
  roomName: string;
  /** The variations to display. */
  variations: readonly GeneratedVariation[];
  /** Currently selected variation id. */
  selectedId: string | null;
  /** Whether a generation is in progress. */
  isGenerating: boolean;
  /**
   * Progress message while generating, e.g. "Generating variation 2 of 4…".
   * Shown below the grid during generation.
   */
  generationProgress: string;
  /** Called when the user clicks a variation thumbnail. */
  onSelect: (id: string) => void;
  /** Called when the user clicks "Generate More Variations". */
  onGenerateMore: () => void;
  /** Called when the user clicks "Use This" on a variation. */
  onUse: (variation: GeneratedVariation) => void;
  className?: string;
}

const COLUMNS = 4;
const GAP = "gap-2";

/**
 * 4-column grid of AI-generated inpainting variations (issue #630).
 *
 * Each thumbnail shows hover state with "Use This" overlay, selected state
 * with terracotta border + glow ring, and loading skeletons during generation.
 * Metadata (seed, guidance, strength, generation time) appears on hover.
 */
export default function GeneratedVariationGrid({
  roomName,
  variations,
  selectedId,
  isGenerating,
  generationProgress,
  onSelect,
  onGenerateMore,
  onUse,
  className,
}: GeneratedVariationGridProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleUseClick = (
    e: React.MouseEvent,
    variation: GeneratedVariation
  ) => {
    e.stopPropagation();
    onUse(variation);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* 4-column variation grid */}
      <div
        role="group"
        aria-label="AI-generated variations"
        className={cn(
          "grid shrink-0",
          `[grid-template-columns:repeat(${COLUMNS},1fr)]`,
          GAP
        )}
      >
        {variations.map((variation) => {
          const isSelected = selectedId === variation.id;
          const isHovered = hoveredId === variation.id;
          const showOverlay = isHovered && !isSelected;

          return (
            <div key={variation.id} className="relative">
              {/* Skeleton shimmer while loading */}
              {isGenerating && (
                <div
                  aria-label="Loading variation"
                  className={cn(
                    "aspect-square w-full animate-pulse rounded-lg bg-muted",
                    "[background:linear-gradient(90deg,theme(colors.muted)_0%,theme(colors.muted/60)_50%,theme(colors.muted)_100%)]",
                    "[background-size:200%_100%]",
                    "animate-[shimmer_1.5s_infinite]"
                  )}
                  style={{
                    backgroundImage:
                      "linear-gradient(90deg, hsl(var(--muted)) 0%, hsl(var(--muted)/60) 50%, hsl(var(--muted)) 100%)",
                    backgroundSize: "200% 100%",
                  }}
                />
              )}

              {/* Thumbnail */}
              {!isGenerating && (
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={
                    variation.seed != null
                      ? `${roomName} variation, seed ${variation.seed}`
                      : `${roomName} variation`
                  }
                  onClick={() => onSelect(variation.id)}
                  onMouseEnter={() => setHoveredId(variation.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(variation.id)}
                  onBlur={() => setHoveredId(null)}
                  className={cn(
                    "group/var relative block aspect-square w-full overflow-hidden rounded-lg border bg-muted transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isSelected
                      ? "border-2 border-secondary shadow-[0_0_0_3px_hsl(var(--secondary)/0.25)]"
                      : "border-border hover:scale-[1.02] hover:border-atelier-taupe/60"
                  )}
                  title={buildTooltip(variation)}
                >
                  <Image
                    src={variation.thumbnailUrl}
                    alt={
                      variation.seed != null
                        ? `Variation, seed ${variation.seed}`
                        : "AI-generated variation"
                    }
                    fill
                    sizes="96px"
                    className="object-cover"
                  />

                  {/* Selected check badge */}
                  {isSelected && (
                    <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-secondary text-white">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      <span className="sr-only">(Selected)</span>
                    </span>
                  )}

                  {/* Hover overlay — "Use This" button */}
                  {showOverlay && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <button
                        type="button"
                        onClick={(e) => handleUseClick(e, variation)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full px-3 py-1.5",
                          "bg-primary text-primary-foreground",
                          "label-sm font-medium",
                          "transition-colors hover:bg-primary/80"
                        )}
                      >
                        Use This
                      </button>
                    </div>
                  )}
                </button>
              )}

              {/* Metadata tooltip — visible below thumbnail on hover */}
              {!isGenerating && isHovered && (
                <div
                  role="tooltip"
                  className={cn(
                    "absolute left-0 top-full z-10 mt-1 w-full min-w-[160px]",
                    "rounded-md border border-border bg-white px-2 py-1.5 shadow-lg",
                    "font-mono text-[10px] leading-relaxed text-foreground"
                  )}
                >
                  {buildMetadataRows(variation)}
                </div>
              )}
            </div>
          );
        })}

        {/* Empty slots to maintain grid shape */}
        {!isGenerating &&
          Array.from({ length: Math.max(0, COLUMNS - (variations.length % COLUMNS)) }).map(
            (_, i) => (
              <div
                key={`empty-${i}`}
                className="aspect-square rounded-lg border border-dashed border-border bg-muted/30"
              />
            )
          )}
      </div>

      {/* Generation progress status */}
      {isGenerating && generationProgress && (
        <p
          aria-live="polite"
          className="text-center font-jakarta text-xs text-atelier-taupe"
        >
          {generationProgress}
        </p>
      )}

      {/* Generate More Variations button */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onGenerateMore}
        disabled={isGenerating}
        className={cn(
          "w-full justify-center gap-1.5 text-atelier-taupe",
          "hover:text-atelier-primary hover:bg-atelier-canvas"
        )}
      >
        <Images className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="label-sm">Generate More Variations</span>
      </Button>
    </div>
  );
}



/** Build tooltip text for a variation. */
function buildTooltip(v: GeneratedVariation): string {
  const parts: string[] = [];
  if (v.seed != null) parts.push(`seed ${v.seed}`);
  if (v.guidance != null) parts.push(`guidance ${v.guidance.toFixed(1)}`);
  if (v.strength != null) parts.push(`strength ${v.strength.toFixed(2)}`);
  if (v.generationTime != null) parts.push(`${v.generationTime.toFixed(1)}s`);
  return parts.length > 0 ? parts.join(" · ") : "AI-generated variation";
}

/** Build metadata rows for the tooltip. */
function buildMetadataRows(v: GeneratedVariation): React.ReactNode {
  const rows: { label: string; value: string }[] = [];
  if (v.seed != null) rows.push({ label: "seed", value: String(v.seed) });
  if (v.guidance != null)
    rows.push({ label: "guidance", value: v.guidance.toFixed(1) });
  if (v.strength != null)
    rows.push({ label: "strength", value: v.strength.toFixed(2) });
  if (v.generationTime != null)
    rows.push({ label: "time", value: `${v.generationTime.toFixed(1)}s` });

  if (rows.length === 0) return null;

  return (
    <>
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="font-mono tabular-nums">{row.value}</span>
        </div>
      ))}
    </>
  );
}
