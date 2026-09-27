"use client";

import { useState } from "react";
import { SignoffPage } from "./signoff-page";
import { SignatureCanvas } from "./signature-canvas";
import type { LookbookRoomData } from "./types";
import { formatLongDate } from "@/lib/relative-time";
import {
  initialSignatureSaveState,
  nextSignatureSaveState,
  signatureSaveFailureMessage,
  type SignatureSaveState,
} from "@/lib/signature-save-state";

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
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
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
      setSignatureDataUrl(dataUrl);
      setSaveState((prev) => nextSignatureSaveState(prev, { kind: "ok" }));
      setSigned(true);
      setShowForm(false);
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
    // Already signed — render the static display. Freshly signed visitors
    // still hold the page-load props (status "Unsigned", no signature), so
    // overlay the just-submitted values; otherwise keep the DB-loaded ones.
    const signedProject = {
      ...project,
      clientSignature: signatureDataUrl ?? project.clientSignature ?? null,
      clientSignatureStatus: "Signed",
      clientSignatureTimestamp: project.clientSignatureTimestamp ?? new Date().toISOString(),
    };
    return <SignoffPage user={user} project={signedProject} rooms={rooms} />;
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
              {formatLongDate(new Date())}
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
