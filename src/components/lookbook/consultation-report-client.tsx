"use client";

import { useState } from "react";
import { SignatureCanvas } from "./signature-canvas";
import type { LookbookRoomData } from "./types";
import type { ProjectData } from "./types";
import {
  ENGAGEMENT_TIERS,
  formatEngagementPrice,
  type EngagementTier,
} from "@/lib/engagement-tiers";

interface ConsultationReportClientProps {
  user: LookbookRoomData["user"];
  project: ProjectData;
  previewToken: string;
}

const APPROVAL_TEXT =
  "I hereby approve the staging plan as presented in this lookbook. I understand that this digital signature constitutes my acceptance of the staging recommendations and design choices outlined herein.";

export function ConsultationReportClient({
  user,
  project,
  previewToken,
}: ConsultationReportClientProps) {
  const [signed, setSigned] = useState(false);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (dataUrl: string) => {
    setError(null);
    try {
      const res = await fetch("/api/sign-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, signatureDataUrl: dataUrl, token: previewToken }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to save signature");
      }
      setSigned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save signature. Please try again.");
    }
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
                    {new Date().toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
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

              {error && (
                <p className="text-red-600 font-jakarta text-sm">{error}</p>
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
