"use client";

import { useState } from "react";
import { SignoffPage } from "./signoff-page";
import { SignatureCanvas } from "./signature-canvas";
import type { LookbookRoomData } from "./types";

interface SignoffPageClientProps {
  user: LookbookRoomData["user"];
  project: LookbookRoomData["project"];
  rooms: LookbookRoomData[];
  previewToken: string;
}

const APPROVAL_TEXT =
  "I hereby approve the staging plan as presented in this lookbook. I understand that this digital signature constitutes my acceptance of the staging recommendations and design choices outlined herein.";

export function SignoffPageClient({ user, project, rooms, previewToken }: SignoffPageClientProps) {
  const [signed, setSigned] = useState(project.clientSignatureStatus === "Signed");
  const [showForm, setShowForm] = useState(!signed);
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
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save signature. Please try again.");
    }
  };

  if (signed) {
    // Already signed — render the static display (server component)
    return <SignoffPage user={user} project={project} rooms={rooms} />;
  }

  if (!showForm) {
    // Pre-sign confirmation — render display with a sign button
    return (
      <div>
        <SignoffPage user={user} project={project} rooms={rooms} />
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-3 bg-stone-800 text-white font-jakarta text-sm rounded-full shadow-lg hover:bg-stone-700 transition-colors"
          >
            Sign & Approve Lookbook
          </button>
        </div>
      </div>
    );
  }

  // Show the signing form
  return (
    <div className="lookbook-page min-h-screen flex flex-col items-center justify-center bg-stone-50 p-12">
      <div className="max-w-lg w-full text-center space-y-6">
        <div className="space-y-2">
          <p className="font-cinzel text-sm tracking-[0.3em] uppercase text-muted-foreground">
            Client Sign-off
          </p>
          <h2 className="font-playfair text-3xl font-bold text-foreground">
            Approve Your Staging Plan
          </h2>
          <div className="w-16 h-0.5 bg-primary mx-auto" />
        </div>

        <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-6 text-left shadow-sm">
          {/* Client name */}
          <div>
            <p className="block font-jakarta text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Client Name
            </p>
            <p className="font-playfair text-xl text-foreground">{project.clientName}</p>
          </div>

          {/* Date */}
          <div>
            <p className="block font-jakarta text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Date
            </p>
            <p className="font-jakarta text-base text-foreground">
              {new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>

          {/* Signature canvas */}
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

          {/* Approval checkbox */}
          <div className="space-y-2">
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

        <button
          onClick={() => setShowForm(false)}
          className="text-stone-500 font-jakarta text-sm hover:text-stone-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
