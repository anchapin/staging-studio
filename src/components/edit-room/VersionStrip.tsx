"use client";

/**
 * Issue #1340 — `<VersionStrip>` + Lookbook slot.
 * Issue #1376 — Per-variant delete (X icon) on each populated variant slot.
 *
 * Single row beneath the canvas that consolidates the three legacy
 * version surfaces (variant-thumbnail-strip, version-history-pills,
 * source-selector-fieldset's "Edit from" picker). Each of the three
 * variant slots renders as a thumbnail + label + touch-up count, the
 * populated slot that matches `lookbookSlot` carries a bronze
 * `<LookbookBadge>`, and the right side hosts the "Use [X] in
 * lookbook" CTA — which collapses to a static "{label} is in the
 * lookbook" line when the user is already viewing the lookbook slot.
 *
 * Magic Patterns reference:
 *   dVy8jC2kXpi1ca8b4A1hcS/components/VersionStrip.tsx
 *
 * The port changes the colors to Atelier tokens (the design's `bg-sage`
 * badge becomes `bg-secondary`, the bronze Atelier choice), drops the
 * dependency on `lucide-react` (the badge has its own inline glyph per
 * the "do not touch legacy" import rules), and lifts data + callbacks to
 * props so the strip is reachable from the shell without a route wiring.
 *
 * Pinned 1:1 by `tests/edit-room-version-strip.test.tsx`.
 */

import { LookbookBadge } from "@/components/edit-room/lookbook-badge";
import { useState } from "react";

import type { SlotId } from "@/lib/edit-room-scope";
import type { Version } from "@/components/edit-room/types";

interface VersionStripProps {
  /** The three version slots, in render order (original / A / B). */
  versions: ReadonlyArray<Version>;
  /** Which variant the canvas is currently displaying. */
  viewing: SlotId;
  /** Which variant is pinned to the lookbook (drives the badge). */
  lookbookSlot: SlotId;
  /** Where the in-flight run will land (drives the "Staging…" state). */
  targetSlot: SlotId;
  /** True while a run is in flight — disables every interactive element. */
  running: boolean;
  /** Fires when the user clicks a populated slot to view it. */
  onSelect: (slot: SlotId) => void;
  /** Fires when the user clicks the "Use X in lookbook" CTA. */
  onUseInLookbook: (slot: SlotId) => void;
  /**
   * Fires when the user confirms deletion of a variant slot (#1376).
   * Only `A` and `B` may be deleted — the `original` slot is immutable.
   * The parent is responsible for hard-deleting the underlying
   * `InpaintVersion` rows and selecting a fallback `viewing` slot.
   */
  onDelete?: (slot: SlotId) => void | Promise<void>;
}

/**
 * Human-readable label for the slot the user is viewing in the CTA.
 * Mirrors the design: original reads "Use original in lookbook";
 * variants read "Use Variant A in lookbook".
 */
function ctaLabelFor(viewing: SlotId): string {
  return viewing === "original" ? "Use original in lookbook" : `Use Variant ${viewing} in lookbook`;
}

/**
 * Renders the three version slots + the lookbook CTA in one row.
 * Sits beneath the canvas at the bottom of the edit-room surface.
 */
export function VersionStrip({
  versions,
  viewing,
  lookbookSlot,
  targetSlot,
  running,
  onSelect,
  onUseInLookbook,
  onDelete,
}: VersionStripProps) {
  const viewingVersion = versions.find((v) => v.id === viewing);

  // #1376 — confirm-delete modal state. `null` means closed.
  const [confirmingDelete, setConfirmingDelete] = useState<SlotId | null>(null);
  // Tracks the in-flight deletion so we can disable both modal buttons.
  const [deleting, setDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!confirmingDelete || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(confirmingDelete);
    } finally {
      setDeleting(false);
      setConfirmingDelete(null);
    }
  };

  return (
    <section
      aria-label="Versions"
      className="flex shrink-0 items-end justify-between gap-6 border-t border-outline/15 bg-surface-container-low px-6 py-3"
    >
      <div className="flex items-end gap-3">
        {versions.map((v) => {
          const isViewing = v.id === viewing;
          const inLookbook = v.id === lookbookSlot;
          const pending = running && v.id === targetSlot;

          if (!v.url) {
            return (
              <div
                key={v.id}
                data-testid="version-slot-empty"
                data-slot={v.id}
                data-pending={pending ? "true" : "false"}
                className="flex w-28 flex-col gap-1.5"
              >
                <div
                  className={
                    "flex aspect-[3/2] w-full items-center justify-center rounded-md border border-dashed " +
                    (pending
                      ? "border-secondary bg-secondary-container/40"
                      : "border-outline")
                  }
                >
                  {pending ? (
                    <span className="text-xs font-medium text-on-secondary-container">
                      Staging…
                    </span>
                  ) : (
                    <PlusIcon className="h-4 w-4 text-on-surface-variant" aria-hidden />
                  )}
                </div>
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-on-surface">{v.label}</p>
                  <p className="text-[11px] text-on-surface-variant">Empty</p>
                </div>
              </div>
            );
          }

          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelect(v.id)}
              disabled={running}
              aria-current={isViewing || undefined}
              data-slot={v.id}
              data-in-lookbook={inLookbook ? "true" : "false"}
              className="group flex w-28 flex-col gap-1.5 text-left disabled:cursor-wait"
            >
              <div
                className={
                  "relative aspect-[3/2] w-full overflow-hidden rounded-md ring-offset-2 ring-offset-surface-container-low transition-[box-shadow] duration-150 " +
                  (isViewing
                    ? "ring-2 ring-primary"
                    : "ring-1 ring-outline-variant group-hover:ring-outline")
                }
              >
                <img src={v.url} alt="" className="h-full w-full object-cover" />
                {inLookbook && <LookbookBadge />}
                {/* #1376 — per-variant delete (X). Only on A/B; original is immutable. */}
                {onDelete && v.id !== "original" && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setConfirmingDelete(v.id);
                    }}
                    disabled={running}
                    aria-label={`Delete ${v.label}`}
                    data-testid={`edit-room-version-strip-delete-${v.id}`}
                    className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-container-highest/90 text-on-surface shadow-sm ring-1 ring-outline-variant backdrop-blur transition-colors hover:bg-error hover:text-on-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CloseIcon className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
              <div className="leading-tight">
                <p
                  className={
                    "text-xs font-semibold " +
                    (isViewing ? "text-on-surface" : "text-on-surface-variant")
                  }
                >
                  {v.label}
                </p>
                <p className="text-[11px] text-on-surface-variant">
                  {v.id === "original"
                    ? "Vacant"
                    : v.touchUps > 0
                      ? `${v.touchUps} touch-up${v.touchUps === 1 ? "" : "s"}`
                      : "First pass"}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-end gap-1 pb-1">
        {viewing === lookbookSlot ? (
          <p
            data-testid="lookbook-in-lookbook-line"
            className="flex items-center gap-1.5 text-xs text-on-surface-variant"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            {viewingVersion?.label ?? "Variant"} is in the lookbook
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onUseInLookbook(viewing)}
            disabled={running}
            data-testid="lookbook-cta"
            className="h-9 whitespace-nowrap rounded-lg border border-outline bg-surface px-3 text-sm font-medium text-on-surface transition-colors duration-150 hover:bg-surface-container-high disabled:opacity-50"
          >
            {ctaLabelFor(viewing)}
          </button>
        )}
      </div>

      {/* #1376 — Confirm-delete modal. Inline + minimal to keep the strip self-contained. */}
      {confirmingDelete && (
        <div
          role="presentation"
          data-testid="edit-room-version-strip-delete-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 px-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !deleting) {
              setConfirmingDelete(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !deleting) {
              setConfirmingDelete(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-room-version-strip-delete-title"
            className="w-full max-w-sm rounded-xl bg-surface-container-low p-5 shadow-2xl ring-1 ring-outline-variant"
          >
            <h2
              id="edit-room-version-strip-delete-title"
              className="text-base font-semibold text-on-surface"
            >
              Delete {confirmingDelete === "A" ? "variant A" : "variant B"}?
            </h2>
            <p className="mt-2 text-sm text-on-surface-variant">
              The variant and its version history will be removed. This can&apos;t
              be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(null)}
                disabled={deleting}
                data-testid="edit-room-version-strip-delete-cancel"
                className="h-9 rounded-lg border border-outline bg-surface px-3 text-sm font-medium text-on-surface transition-colors duration-150 hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                data-testid="edit-room-version-strip-delete-confirm"
                className="h-9 rounded-lg bg-error px-3 text-sm font-medium text-on-error transition-colors duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Inline `Plus` glyph — keeps the strip zero-dependency. */
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Inline `Close` (X) glyph — matches PlusIcon + BookOpen's zero-dependency style. */
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

/** Inline `BookOpen` glyph — same SVG as `<LookbookBadge>`'s. */
function BookOpen({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" />
      <path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}
