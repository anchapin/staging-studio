"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, ImageIcon, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { StagedVariantPair } from "@/lib/staged-result";
import type { VariantStripSelection } from "@/lib/variant-legibility";
import type { VariantSlot } from "@/lib/inpaint-source";

/** Thumbnails render at a fixed 208px square (issue #479 — 96px was too small to see detail). */
const THUMBNAIL_SIZES = "208px";

const VARIANT_LETTER: Record<VariantSlot, "A" | "B"> = { 0: "A", 1: "B" };

/**
 * Alt text for a variant thumbnail. Deliberately distinct from
 * `stagedResultAlt` (used by the full-size staged result) so e2e
 * selectors keying on the staged image's alt never match two elements.
 */
function thumbnailAlt(roomName: string, slot: VariantSlot): string {
  const prefix = roomName.trim() ? `${roomName.trim()} — ` : "";
  return `${prefix}Variant ${VARIANT_LETTER[slot]} thumbnail`;
}

interface VariantThumbnailStripProps {
  /** Room display name — only used to build descriptive alt text. */
  roomName: string;
  /** The room's original before photo (the strip's first thumbnail). */
  originalUrl: string | null;
  /** The room's two variant pairs; an incomplete pair renders a placeholder. */
  pairs: readonly [StagedVariantPair, StagedVariantPair];
  /** Highlighted item, pre-derived via `resolveStripSelection`. */
  selection: VariantStripSelection;
  /**
   * Click handler for any strip item: `"original"` (issue #192 — clears
   * the lookbook selection) or the variant slot to select.
   */
  onSelect: (selection: VariantStripSelection) => void;
  /**
   * Per-variant delete (issue #192). When provided, a trash button
   * renders on each variant that has a staged after-image.
   */
  onDeleteVariant?: (slot: VariantSlot) => void;
  /** Slot whose delete is in flight (spinner on its trash button). */
  deletingSlot?: VariantSlot | null;
  /**
   * Per-slot touch-up totals (issue #192) — shown as a small badge on
   * each variant thumbnail once at least one touch-up has landed.
   */
  touchUpCounts?: Readonly<{ 0: number; 1: number }> | null;
  className?: string;
}

/**
 * Persistent Original / Variant A / Variant B thumbnail strip (issue
 * #192). Clicking a thumbnail selects it — a staged variant for the
 * lookbook, or Original to clear the selection; the selected item gets a
 * ring + check badge and a bold caption. Each staged variant carries a
 * touch-up badge and a delete button; an unstaged slot renders a "Not
 * staged yet" placeholder so the strip never changes size or ordering.
 */
export default function VariantThumbnailStrip({
  roomName,
  originalUrl,
  pairs,
  selection,
  onSelect,
  onDeleteVariant,
  deletingSlot = null,
  touchUpCounts = null,
  className,
}: VariantThumbnailStripProps) {
  const trimmedName = roomName.trim();

  // Confirm dialog state for delete variant
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    slot: VariantSlot | null;
  }>({ open: false, slot: null });
  return (
    <div
      role="group"
      aria-label="Room variants"
      className={cn("flex snap-x snap-mandatory items-start gap-3 overflow-x-auto pb-2", className)}
    >
      <div className="flex w-20 sm:w-24 shrink-0 snap-start flex-col items-center gap-1">
        <button
          type="button"
          aria-pressed={selection === "original"}
          onClick={() => onSelect("original")}
          className={cn(
            "relative block h-52 w-52 overflow-hidden rounded-md border bg-muted transition-shadow",
            selection === "original"
              ? "border-foreground ring-2 ring-ring ring-offset-2"
              : "border-border hover:border-muted-foreground"
          )}
        >
          {originalUrl ? (
            <Image
              src={originalUrl}
              alt={trimmedName ? `${trimmedName} original photo` : "Original photo"}
              fill
              sizes={THUMBNAIL_SIZES}
              className="object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </span>
          )}
          {selection === "original" && <SelectedBadge />}
        </button>
        <ThumbLabel selected={selection === "original"}>Original</ThumbLabel>
      </div>

      {([0, 1] as const).map((slot) => {
        const pair = pairs[slot];
        const hasAfter = Boolean(pair.after);
        const selected = selection === slot;
        const deleting = deletingSlot === slot;
        const letter = VARIANT_LETTER[slot];
        const touchUps = touchUpCounts?.[slot] ?? 0;
        return (
          <div key={slot} className="flex w-44 sm:w-52 shrink-0 snap-start flex-col items-center gap-1">
            <span className="relative block h-52 w-52">
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(slot)}
                className={cn(
                  "relative block h-52 w-52 overflow-hidden rounded-md border bg-muted transition-shadow",
                  selected
                    ? "border-foreground ring-2 ring-ring ring-offset-2"
                    : "border-border hover:border-muted-foreground"
                )}
              >
                {hasAfter && pair.after ? (
                  <Image
                    src={pair.after}
                    alt={thumbnailAlt(roomName, slot)}
                    fill
                    sizes={THUMBNAIL_SIZES}
                    className="object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border">
                    <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    <span className="px-1 text-center text-[10px] leading-none text-muted-foreground">
                      Not staged yet
                    </span>
                  </span>
                )}
                {selected && <SelectedBadge />}
                <span className="absolute left-1 top-1">
                  <Badge variant={hasAfter ? "success" : "warning"} size="sm">
                    {hasAfter ? "Staged" : "Not staged"}
                  </Badge>
                </span>
                {touchUps > 0 && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium leading-none text-white">
                    {touchUps} touch-up{touchUps === 1 ? "" : "s"}
                  </span>
                )}
              </button>
                {onDeleteVariant && hasAfter && (
                  <button
                    type="button"
                    aria-label={`Delete Variant ${letter} staged image`}
                    disabled={deleting}
                    onClick={() => {
                      setConfirmDialog({ open: true, slot });
                    }}
                    tabIndex={0}
                    className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-red-600 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              )}
            </span>
            <ThumbLabel selected={selected}>Variant {letter}</ThumbLabel>
          </div>
        );
      })}
      <ConfirmDialog
        open={confirmDialog.open}
        onCancel={() => setConfirmDialog({ open: false, slot: null })}
        onConfirm={() => {
          if (confirmDialog.slot !== null && onDeleteVariant) {
            onDeleteVariant(confirmDialog.slot);
          }
        }}
        title="Delete this variant?"
        message="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
}

/** Check badge pinned to a selected thumbnail's top-left corner. */
function SelectedBadge() {
  return (
    <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
      <Check className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">(Selected)</span>
    </span>
  );
}

/** Caption under a thumbnail; bold when its item is selected. */
function ThumbLabel({
  selected,
  children,
}: {
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-xs",
        selected ? "font-semibold text-foreground" : "text-muted-foreground"
      )}
    >
      {children}
      {selected && <span className="sr-only"> (Selected)</span>}
    </span>
  );
}
