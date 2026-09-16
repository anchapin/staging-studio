"use client";

import { useState, useCallback } from "react";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { Loader2, Sparkles } from "lucide-react";

interface GenerateCopyFormProps {
  roomId: string;
  roomName: string;
  aesthetic: string;
  targetBuyer: string;
  initialDirectives?: string;
  onCopyGenerated?: (copy: GeneratedCopy, rawDirectives: string) => void;
}

export interface GeneratedCopy {
  observedChallenge: string;
  recommendation: string;
  buyerPsychology: string;
  checklist: Array<{
    item: string;
    category: "DIY/Declutter" | "Rental Inventory" | "Minor Repair";
    priority: "Critical" | "High" | "Standard";
  }>;
}

export default function GenerateCopyForm({
  roomId,
  roomName,
  aesthetic,
  targetBuyer,
  initialDirectives = "",
  onCopyGenerated,
}: GenerateCopyFormProps) {
  const [rawDirectives, setRawDirectives] = useState(initialDirectives);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copy, setCopy] = useState<GeneratedCopy | null>(null);
  const { toasts, showError, showSuccess, dismissToast } = useToast();

  const handleGenerate = useCallback(async () => {
    const trimmedDirectives = rawDirectives.trim();
    if (!trimmedDirectives) {
      showError("Please provide staging directives for this room.");
      return;
    }

    setIsGenerating(true);

    try {
      const response = await fetch("/api/generate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          roomName: roomName.trim().slice(0, 200),
          rawDirectives: trimmedDirectives,
          aesthetic: aesthetic.trim().slice(0, 200),
          targetBuyer,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || "Failed to generate copy");
      }

      setCopy(data.data);
      showSuccess("Copy generated successfully!");
      onCopyGenerated?.(data.data, trimmedDirectives);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate copy";
      showError(
        message,
        true,
        () => {
          handleGenerate();
        },
        "Retry copy generation"
      );
    } finally {
      setIsGenerating(false);
    }
  }, [roomId, roomName, rawDirectives, aesthetic, targetBuyer, onCopyGenerated, showError, showSuccess]);

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="staging-directives"
          className="block text-sm font-medium text-stone-700 mb-1"
        >
          Staging Directives
        </label>
        <textarea
          id="staging-directives"
          value={rawDirectives}
          onChange={(e) => setRawDirectives(e.target.value)}
          placeholder="Describe the key staging priorities and changes needed for this room..."
          rows={4}
          maxLength={2000}
          className="w-full px-3 py-2 border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-500 resize-none"
        />
      </div>

      <button
        onClick={handleGenerate}
        disabled={isGenerating || !rawDirectives.trim()}
        className={`
          flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
          transition-colors
          ${isGenerating || !rawDirectives.trim()
            ? "bg-stone-300 text-stone-500 cursor-not-allowed"
            : "bg-stone-800 text-white hover:bg-stone-700"
          }
        `}
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Generate Copy
          </>
        )}
      </button>

      {copy && (
        <div className="mt-6 p-4 bg-stone-50 rounded-lg border border-stone-200 space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              Observed Challenge
            </h4>
            <p className="mt-1 text-stone-800">{copy.observedChallenge}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              Recommendation
            </h4>
            <p className="mt-1 text-stone-800">{copy.recommendation}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              Buyer Psychology
            </h4>
            <p className="mt-1 text-stone-800">{copy.buyerPsychology}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
              Checklist
            </h4>
            <ul className="space-y-2">
              {copy.checklist.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <span className={`
                    px-1.5 py-0.5 rounded text-xs font-medium
                    ${item.category === "DIY/Declutter" ? "bg-blue-100 text-blue-700" : ""}
                    ${item.category === "Rental Inventory" ? "bg-purple-100 text-purple-700" : ""}
                    ${item.category === "Minor Repair" ? "bg-amber-100 text-amber-700" : ""}
                  `}>
                    {item.category}
                  </span>
                  <span className={`
                    px-1.5 py-0.5 rounded text-xs font-medium
                    ${item.priority === "Critical" ? "bg-red-100 text-red-700" : ""}
                    ${item.priority === "High" ? "bg-orange-100 text-orange-700" : ""}
                    ${item.priority === "Standard" ? "bg-green-100 text-green-700" : ""}
                  `}>
                    {item.priority}
                  </span>
                  <span className="text-stone-700">{item.item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
