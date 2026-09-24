"use client";

import Image from "next/image";
import { MoreHorizontal, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StagedVariantPair } from "@/lib/staged-result";
import { sliderFillStyle } from "@/lib/precision-slider";
import {
  cardBorderClasses,
  resolveRoomStatus,
  statusBadgeClasses,
  statusLabel,
} from "@/lib/room-batch-card-matrix";
import type { CameraLabel } from "@/lib/room-batch-card-matrix";

// Re-exported for API stability: these types originate in
// `@/lib/room-batch-card-matrix` (see issue #707).
export type { CameraLabel, RoomCardStatus } from "@/lib/room-batch-card-matrix";

export interface RoomBatchCardProps {
  /** Room display name */
  roomName: string;
  /** Camera label badge text */
  cameraLabel?: CameraLabel;
  /** The room's before photo URL */
  beforeImageUrl: string | null;
  /** The room's two variant pairs */
  pairs: readonly [StagedVariantPair, StagedVariantPair];
  /** Staging intensity value 0-100 */
  stagingIntensity?: number;
  /** Called when staging intensity changes */
  onIntensityChange?: (value: number) => void;
  /** Prompt injection value */
  promptInjection?: string;
  /** Called when prompt injection changes */
  onPromptInjectionChange?: (value: string) => void;
  /** Called when the user clicks "Edit Staging" */
  onEditStaging?: () => void;
  /** Called when the user clicks "Generate Variation" */
  onGenerateVariation?: () => void;
  /** Called when the user selects a variant */
  onSelectVariant?: (slot: 0 | 1) => void;
  /** Called when the user clicks delete on a variant */
  onDeleteVariant?: (slot: 0 | 1) => void;
  /** Currently selected variant index */
  selectedVariantIndex?: number | null;
  /** Whether the card is in a disabled state */
  disabled?: boolean;
  className?: string;
}

export function RoomBatchCard({
  roomName,
  cameraLabel,
  beforeImageUrl,
  pairs,
  stagingIntensity = 50,
  onIntensityChange,
  promptInjection = "",
  onPromptInjectionChange,
  onGenerateVariation,
  onSelectVariant,
  selectedVariantIndex,
  disabled = false,
  className,
}: RoomBatchCardProps) {
  const status = resolveRoomStatus(pairs);
  const completedVariants = [pairs[0], pairs[1]].filter((p) => p.after !== null);
  const variantCount = completedVariants.length;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onIntensityChange?.(Number(e.target.value));
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-surface-container-low p-4",
        cardBorderClasses(status),
        disabled && "opacity-60 pointer-events-none",
        className
      )}
    >
      {/* Top Row */}
      <div className="flex items-start gap-3">
        {/* Room thumbnail */}
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted">
          {beforeImageUrl ? (
            <Image
              src={beforeImageUrl}
              alt={`${roomName} photo`}
              fill
              sizes="64px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-xs text-muted-foreground">No photo</span>
            </div>
          )}
        </div>

        {/* Room info */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="title-md truncate font-semibold text-foreground">
            {roomName}
          </h3>

          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-1.5">
            {cameraLabel && (
              <span className="label-sm rounded bg-surface-container px-1.5 py-0.5 font-semibold uppercase tracking-wide text-muted-foreground">
                {cameraLabel}
              </span>
            )}
            <span className={cn("label-sm rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wide", statusBadgeClasses(status))}>
              {statusLabel(status)}
            </span>
          </div>
        </div>

        {/* Ellipsis menu */}
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Room options"
          disabled={disabled}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* Middle Row - Staging Intensity Slider */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="label-sm text-muted-foreground">
            Staging Intensity
          </span>
          <span className="font-mono text-xs tabular-nums text-foreground">
            {stagingIntensity}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={stagingIntensity}
          onChange={handleSliderChange}
          disabled={disabled || status === "staged"}
          className="atelier-slider w-full"
          style={sliderFillStyle(stagingIntensity, 0, 100)}
          aria-label="Staging intensity"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Light</span>
          <span>Full</span>
        </div>
      </div>

      {/* Prompt Injection Textarea */}
      <div className="flex flex-col gap-1">
        <textarea
          value={promptInjection}
          onChange={(e) => onPromptInjectionChange?.(e.target.value)}
          placeholder="Inject additional staging directives..."
          disabled={disabled}
          rows={2}
          className="body-sm min-h-[3.5rem] w-full resize-y rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Prompt injection"
        />
      </div>

      {/* Bottom Row - Variant Strip */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="label-sm text-muted-foreground">
            Variations:
          </span>
          <span className="label-sm text-muted-foreground">
            {variantCount}/3
          </span>
        </div>

        {/* Variant thumbnails strip */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {/* Existing variants */}
          {([0, 1] as const).map((slot) => {
            const pair = pairs[slot];
            const hasVariant = pair.after !== null;
            const isSelected = selectedVariantIndex === slot;

            if (hasVariant && pair.after) {
              return (
                <div key={slot} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => onSelectVariant?.(slot)}
                    disabled={disabled}
                    className={cn(
                      "relative block h-12 w-12 overflow-hidden rounded-md border-2 bg-muted transition-shadow",
                      isSelected ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-muted-foreground"
                    )}
                    aria-label={`Variant ${slot === 0 ? "A" : "B"}`}
                    aria-pressed={isSelected}
                  >
                    <Image
                      src={pair.after}
                      alt={`Variant ${slot === 0 ? "A" : "B"}`}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  </button>
                  {isSelected && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[8px] text-primary-foreground">
                      ✓
                    </span>
                  )}
                </div>
              );
            }

            return null;
          })}

          {/* Generate Variation button */}
          {variantCount < 3 && (
            <button
              type="button"
              onClick={onGenerateVariation}
              disabled={disabled}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/50 text-muted-foreground transition-colors hover:border-primary hover:bg-muted hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Generate variation"
            >
              <Sparkles className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export interface RoomBatchCardMatrixProps {
  /** Array of room data to render */
  rooms: Array<{
    id: string;
    name: string;
    beforeImageUrl: string | null;
    pairs: readonly [StagedVariantPair, StagedVariantPair];
    stagingIntensity?: number;
    promptInjection?: string;
    selectedVariantIndex?: number | null;
    cameraLabel?: CameraLabel;
  }>;
  /** Called when staging intensity changes for a room */
  onIntensityChange?: (roomId: string, value: number) => void;
  /** Called when prompt injection changes for a room */
  onPromptInjectionChange?: (roomId: string, value: string) => void;
  /** Called when user clicks generate variation for a room */
  onGenerateVariation?: (roomId: string) => void;
  /** Called when user selects a variant */
  onSelectVariant?: (roomId: string, slot: 0 | 1) => void;
  /** Whether cards are disabled */
  disabled?: boolean;
  className?: string;
}

function computeSummaryStats(rooms: RoomBatchCardMatrixProps["rooms"]) {
  const totalRooms = rooms.length;
  const readyRooms = rooms.filter((room) =>
    room.pairs[0].after !== null || room.pairs[1].after !== null
  ).length;
  const totalVariants = rooms.reduce(
    (acc, room) =>
      acc + [room.pairs[0], room.pairs[1]].filter((p) => p.after !== null).length,
    0
  );
  return { totalRooms, readyRooms, totalVariants };
}

export function RoomBatchCardMatrix({
  rooms,
  onIntensityChange,
  onPromptInjectionChange,
  onGenerateVariation,
  onSelectVariant,
  disabled = false,
  className,
}: RoomBatchCardMatrixProps) {
  const { totalRooms, readyRooms, totalVariants } = computeSummaryStats(rooms);

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {/* Summary Row */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="font-jakarta font-medium text-foreground">
          {totalRooms} Room{totalRooms !== 1 ? "s" : ""}
        </span>
        <span>·</span>
        <span className="font-jakarta font-medium text-foreground">
          {readyRooms} Ready
        </span>
        <span>·</span>
        <span className="font-jakarta font-medium text-foreground">
          {totalVariants} Total Variations
        </span>
      </div>

      {/* Room Cards Grid */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rooms.map((room) => (
          <RoomBatchCard
            key={room.id}
            roomName={room.name}
            cameraLabel={room.cameraLabel}
            beforeImageUrl={room.beforeImageUrl}
            pairs={room.pairs}
            stagingIntensity={room.stagingIntensity}
            onIntensityChange={(value) => onIntensityChange?.(room.id, value)}
            promptInjection={room.promptInjection}
            onPromptInjectionChange={(value) => onPromptInjectionChange?.(room.id, value)}
            onGenerateVariation={() => onGenerateVariation?.(room.id)}
            onSelectVariant={(slot) => onSelectVariant?.(room.id, slot)}
            selectedVariantIndex={room.selectedVariantIndex}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
