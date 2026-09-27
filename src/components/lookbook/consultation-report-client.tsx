"use client";

import { useState } from "react";
import { SignatureCanvas } from "./signature-canvas";
import { MaterialSwatchCard } from "./material-swatch-card";
import { ConsultationFurnitureTable } from "./consultation-furniture-table";
import type { LookbookRoomData, MaterialSwatchData } from "./types";
import type { ProjectData } from "./types";
import type { PreviewProcurementItem } from "@/app/(print)/preview/[id]/lookbook-preview-view";
import {
  ENGAGEMENT_TIERS,
  formatEngagementPrice,
  type EngagementTier,
} from "@/lib/engagement-tiers";
import { formatLongDate } from "@/lib/relative-time";
import {
  initialSignatureSaveState,
  nextSignatureSaveState,
  signatureSaveFailureMessage,
  type SignatureSaveState,
} from "@/lib/signature-save-state";

interface ConsultationReportClientProps {
  user: LookbookRoomData["user"];
  project: ProjectData;
  previewToken: string;
  materialSwatches?: MaterialSwatchData[];
  procurementItems?: PreviewProcurementItem[];
}

const APPROVAL_TEXT =
  "I hereby approve the staging plan as presented in this lookbook. I understand that this digital signature constitutes my acceptance of the staging recommendations and design choices outlined herein.";

export function ConsultationReportClient({
  user,
  project,
  previewToken,
  materialSwatches = [],
  procurementItems = [],
}: ConsultationReportClientProps) {
  const [signed, setSigned] = useState(false);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  // Issue #1060: signature save state machine — initial state idle,
  // transitions to saving → signed (terminal) or failed (retriable).
  const [saveState, setSaveState] = useState<SignatureSaveState>(
    initialSignatureSaveState
  );

  const submitSignature = async (dataUrl: string) => {
    setSaveState((prev) => nextSignatureSaveState(prev, { kind: "save", dataUrl }));
    try {
      const res = await fetch("/api/sign-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, signatureDataUrl: dataUrl, token: previewToken }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message);
      }
      setSaveState((prev) => nextSignatureSaveState(prev, { kind: "ok" }));
      setSigned(true);
    } catch (err) {
      const errorMessage = signatureSaveFailureMessage(
        err instanceof Error ? err.message : undefined
      );
      setSaveState((prev) =>
        nextSignatureSaveState(prev, { kind: "fail", error: errorMessage })
      );
      // The canvas pixels stay drawn (the SignatureCanvas <canvas>
      // element is not unmounted until `signed` flips or the user
      // explicitly discards) so the user can retry without redrawing.
    }
  };

  const handleSave = async (dataUrl: string) => {
    await submitSignature(dataUrl);
  };

  const handleRetry = () => {
    // Read the latest state via a ref-like pattern: dispatch the
    // retry event and read the next state's pendingDataUrl from the
    // result. The state setter's functional updater returns the
    // resolved next state, which we capture here.
    let dataUrlToRetry: string | null = null;
    setSaveState((prev) => {
      const next = nextSignatureSaveState(prev, { kind: "retry" });
      if (next.kind === "saving") {
        dataUrlToRetry = next.pendingDataUrl;
      }
      return next;
    });
    if (dataUrlToRetry) {
      void submitSignature(dataUrlToRetry);
    }
  };

  const handleDiscardAndRedraw = () => {
    setSaveState((prev) => nextSignatureSaveState(prev, { kind: "discard" }));
  };

  if (signed) {
    return (
      <div className="lookbook-page min-h-screen flex flex-col items-center justify-center bg-stone-50 p-12">
        <div className="max-w-2xl w-full text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-green-100 border border-green-200 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="font-playfair text-3xl font-bold text-foreground">
            Proposal Accepted
          </h2>
          <p className="font-jakarta text-muted-foreground">
            Thank you, {project.clientName}. Your signature has been recorded and your acceptance has been sent to {user.firmName}.
          </p>
          <div className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-50 border border-green-200 rounded-full text-sm font-jakarta text-green-700 font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Signed & Approved
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lookbook-page min-h-screen flex flex-col items-center justify-between bg-stone-50 p-12">
      <div className="flex-1 flex flex-col items-center justify-center w-full">
        <div className="max-w-4xl w-full space-y-8">
          {/* Section header */}
          <div className="text-center space-y-3">
            <p className="font-cinzel text-sm tracking-[0.3em] uppercase text-muted-foreground">
              Client Consultation Report
            </p>
            <h2 className="font-playfair text-4xl font-bold text-foreground">
              Choose Your Engagement
            </h2>
            <div className="w-24 h-0.5 bg-primary mx-auto" />
          </div>

          {/* Engagement Tier Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {ENGAGEMENT_TIERS.map((tier) => (
              <TierCard
                key={tier.id}
                tier={tier}
                selected={selectedTier === tier.id}
                onSelect={() => setSelectedTier(tier.id)}
              />
            ))}
          </div>

          {/* Material Swatch Cards (horizontal scroll) */}
          {materialSwatches.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-cinzel text-xs tracking-widest uppercase text-on-surface-variant">
                Material Specifications
              </h3>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {materialSwatches.map((swatch) => (
                  <MaterialSwatchCard key={swatch.id} swatch={swatch} />
                ))}
              </div>
            </div>
          )}

          {/* Furniture Procurement Table */}
          {procurementItems.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-cinzel text-xs tracking-widest uppercase text-on-surface-variant">
                Furniture Procurement
              </h3>
              <ConsultationFurnitureTable items={procurementItems} />
              {/* Procurement Note */}
              <div className="bg-secondary/10 border-l-4 border-secondary rounded-r-lg p-4">
                <p className="font-jakarta text-sm text-foreground leading-relaxed">
                  All items sourced from vetted suppliers. Lead times account for shipping. Substitutions may be required based on availability.
                </p>
              </div>
            </div>
          )}

          {/* Signature Section */}
          <div className="mt-8 p-6 bg-surface-container-low rounded-xl border border-outline-variant/40">
            <h3 className="font-playfair text-2xl font-semibold text-foreground mb-6">
              Client Acceptance
            </h3>

            {/* Prepared by */}
            <p className="font-jakarta text-sm text-muted-foreground mb-6">
              Prepared by {user.firmName}
            </p>

            {/* Signature Canvas */}
            <div className="space-y-4">
              <div>
                <p className="block font-jakarta text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Signature
                </p>
                <SignatureCanvas
                  onSave={handleSave}
                  clientName={project.clientName}
                  disabled={false}
                />
              </div>

              {/* Typed name and date */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="block font-jakarta text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    Typed Name
                  </p>
                  <p className="font-playfair text-lg text-foreground border-b border-on-surface-variant/40 pb-1">
                    {project.clientName}
                  </p>
                </div>
                <div>
                  <p className="block font-jakarta text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    Date
                  </p>
                  <p className="font-playfair text-lg text-foreground border-b border-on-surface-variant/40 pb-1">
                    {formatLongDate(new Date())}
                  </p>
                </div>
              </div>

              {/* Approval checkbox */}
              <div className="space-y-2 pt-4">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-stone-400 text-stone-800 focus:ring-stone-500 cursor-pointer"
                  />
                  <span className="font-jakarta text-sm text-stone-600 leading-relaxed">
                    {APPROVAL_TEXT}
                  </span>
                </label>
              </div>

              {saveState.kind === "failed" && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3"
                >
                  <div className="flex items-start gap-3">
                    <svg
                      className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3l-6.93-12a2 2 0 00-3.48 0l-6.93 12a2 2 0 001.74 3z"
                      />
                    </svg>
                    <div className="flex-1 space-y-1">
                      <p className="font-jakarta text-sm font-medium text-red-800">
                        We couldn&apos;t save your signature.
                      </p>
                      <p className="font-jakarta text-sm text-red-700">{saveState.error}</p>
                      <p className="font-jakarta text-xs text-red-600">
                        Your signature is still on the canvas — you can retry, or
                        clear and sign again.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 pl-8">
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="px-3 py-1.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      Retry save
                    </button>
                    <button
                      type="button"
                      onClick={handleDiscardAndRedraw}
                      className="px-3 py-1.5 text-sm font-medium rounded-md border border-red-300 text-red-700 bg-white hover:bg-red-50 transition-colors"
                    >
                      Discard and sign again
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Selected tier indicator */}
          {selectedTier && (
            <div className="text-center">
              <p className="font-jakarta text-sm text-muted-foreground">
                Selected:{" "}
                <span className="font-semibold text-foreground">
                  {ENGAGEMENT_TIERS.find((t) => t.id === selectedTier)?.name}
                </span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface TierCardProps {
  tier: EngagementTier;
  selected: boolean;
  onSelect: () => void;
}

function TierCard({ tier, selected, onSelect }: TierCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-xl border-2 p-6 transition-all ${
        selected
          ? "border-secondary bg-secondary/5 shadow-md"
          : "border-outline-variant hover:border-secondary/50 hover:bg-surface-container-low"
      } ${tier.recommended ? "relative" : ""}`}
    >
      {/* Recommended badge */}
      {tier.recommended && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-secondary text-white rounded-full px-3 py-1 text-xs font-jakarta font-medium whitespace-nowrap">
          Recommended
        </span>
      )}

      {/* Tier name and tagline */}
      <div className="space-y-2 mb-4">
        <p className="font-playfair text-xl font-semibold text-foreground">
          {tier.name}
        </p>
        <p className="font-jakarta text-sm text-muted-foreground">
          {tier.tagline}
        </p>
      </div>

      {/* Price */}
      <div className="mb-4">
        <p className="font-playfair text-3xl font-bold text-foreground">
          {formatEngagementPrice(tier.price)}
        </p>
      </div>

      {/* Includes */}
      <ul className="space-y-2 mb-6">
        {tier.includes.map((item) => (
          <li key={item} className="flex items-start gap-2 font-jakarta text-sm text-foreground">
            <svg
              className="w-4 h-4 text-secondary flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {item}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div
        className={`w-full py-2.5 rounded-md text-center font-jakarta text-sm font-medium transition-colors ${
          tier.recommended
            ? "bg-secondary text-white hover:bg-secondary/90"
            : "bg-white border border-outline text-foreground hover:border-secondary hover:text-secondary"
        }`}
      >
        {tier.cta}
      </div>
    </button>
  );
}
