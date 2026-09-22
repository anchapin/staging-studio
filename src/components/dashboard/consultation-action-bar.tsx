"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CONSULTATION_BAR_DIVIDER_CLASSES,
  CONSULTATION_BAR_INNER_CLASSES,
  CONSULTATION_BAR_PADDING_CLASSES,
  CONSULTATION_BAR_POSITION_CLASSES,
  CONSULTATION_BAR_SUBTEXT,
  CONSULTATION_BAR_SURFACE_CLASSES,
  CONSULTATION_CTA_WIDTH_CLASSES,
  CONSULTATION_CONFIG_UNCONFIGURED_LABEL,
  CONSULTATION_GHOST_CTA_CLASSES,
  CONSULTATION_PRIMARY_CTA_CLASSES,
  CONSULTATION_PULSE_DOT_CORE_CLASSES,
  CONSULTATION_PULSE_DOT_HALO_CLASSES,
  CONSULTATION_SUBTEXT_CLASSES,
} from "@/lib/consultation-action-bar";

interface ConsultationActionBarProps {
  /** Bold configuration summary shown after "Configured:" */
  configName: string;
  /** Called when "Save Draft" is clicked */
  onSaveDraft: () => void;
  /** Called when "Save & Proceed to Room Batch Stage" is clicked */
  onProceed: () => void;
  /** Disables both CTAs (e.g. while the project is being created) */
  busy?: boolean;
  /** Transient label swap for the draft button after a draft save */
  draftSaved?: boolean;
}

/**
 * Issue #619: Sticky bottom consultation action bar for the Client Project
 * Setup screen (Step 1). Fixed to the viewport bottom with a frosted
 * glassmorphic surface; shows the live configuration summary and the
 * "Save Draft" / "Save & Proceed to Room Batch Stage" CTAs. On mobile the
 * clusters stack, the descriptive subtext hides, and buttons go full-width.
 */
export function ConsultationActionBar({
  configName,
  onSaveDraft,
  onProceed,
  busy = false,
  draftSaved = false,
}: ConsultationActionBarProps) {
  return (
    <footer
      aria-label="Consultation actions"
      className={`${CONSULTATION_BAR_POSITION_CLASSES} ${CONSULTATION_BAR_SURFACE_CLASSES} ${CONSULTATION_BAR_PADDING_CLASSES}`}
    >
      <div className={CONSULTATION_BAR_INNER_CLASSES}>
        {/* Left cluster: pulsing dot + config summary + subtext */}
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
              <span className={CONSULTATION_PULSE_DOT_HALO_CLASSES} />
              <span className={CONSULTATION_PULSE_DOT_CORE_CLASSES} />
            </span>
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              Configured:{" "}
              <span
                className={
                  configName === CONSULTATION_CONFIG_UNCONFIGURED_LABEL
                    ? "font-normal italic"
                    : "font-semibold text-foreground"
                }
              >
                {configName}
              </span>
            </p>
          </div>

          <div
            className={CONSULTATION_BAR_DIVIDER_CLASSES}
            aria-hidden="true"
          />

          <p className={CONSULTATION_SUBTEXT_CLASSES}>
            {CONSULTATION_BAR_SUBTEXT}
          </p>
        </div>

        {/* Right cluster: Save Draft + Save & Proceed */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onSaveDraft}
            disabled={busy}
            className={`${CONSULTATION_GHOST_CTA_CLASSES} ${CONSULTATION_CTA_WIDTH_CLASSES}`}
          >
            {draftSaved ? "Draft Saved" : "Save Draft"}
          </Button>
          <Button
            type="button"
            onClick={onProceed}
            disabled={busy}
            className={`${CONSULTATION_PRIMARY_CTA_CLASSES} ${CONSULTATION_CTA_WIDTH_CLASSES}`}
          >
            {busy ? "Saving..." : "Save & Proceed to Room Batch Stage"}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </footer>
  );
}
