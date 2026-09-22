"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { Loader2, Sparkles } from "lucide-react";
import { saveRoomMetadata, saveRoomCopy } from "@/app/actions/room";

interface GenerateCopyFormProps {
  roomId: string;
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
  initialDirectives = "",
  onCopyGenerated,
}: GenerateCopyFormProps) {
  const [rawDirectives, setRawDirectives] = useState(initialDirectives);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copy, setCopy] = useState<GeneratedCopy | null>(null);
  const { toasts, showError, showSuccess, dismissToast } = useToast();

  /**
   * Persists already-generated copy via the `saveRoomCopy` server action
   * without re-invoking generation. Used to recover from the route's
   * `save_failed` response so paid generation is not discarded; a retry
   * re-runs this save-only path, never the full generation.
   */
  const persistCopy = useCallback(
    async (copyToSave: GeneratedCopy, directives: string): Promise<boolean> => {
      setIsGenerating(true);
      try {
        const result = await saveRoomCopy(roomId, copyToSave);
        if (result.success) {
          setCopy(copyToSave);
          showSuccess("Copy saved successfully!");
          onCopyGenerated?.(copyToSave, directives);
          return true;
        }
        showError(
          result.error || "Copy was generated but could not be saved.",
          true,
          () => {
            void persistCopy(copyToSave, directives);
          },
          "Retry save"
        );
        return false;
      } finally {
        setIsGenerating(false);
      }
    },
    // Self-reference resolves at call time, so the retry closure above
    // always reaches the latest `persistCopy` binding.
    [roomId, onCopyGenerated, showSuccess, showError]
  );

  const handleGenerate = useCallback(async () => {
    const trimmedDirectives = rawDirectives.trim();
    if (!trimmedDirectives) {
      showError("Please provide staging directives for this room.");
      return;
    }

    setIsGenerating(true);

    try {
      // The generate-copy route builds its prompt from the persisted Room
      // record (single source of truth), so the directives must be saved
      // before generation, not after.
      const saveResult = await saveRoomMetadata(roomId, {
        rawDirectives: trimmedDirectives,
      });
      if (!saveResult.success) {
        throw new Error(saveResult.error || "Failed to save staging directives");
      }

      const response = await fetch("/api/generate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });

      const data = await response.json();

      if (!response.ok) {
        // The route generated the copy but failed to persist it; retry
        // save-only with the returned copy instead of regenerating.
        if (data?.error === "save_failed" && data?.copy) {
          await persistCopy(data.copy, trimmedDirectives);
          return;
        }
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
  }, [roomId, rawDirectives, onCopyGenerated, persistCopy, showError, showSuccess]);

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="staging-directives"
          className="block text-sm font-medium text-foreground mb-1"
        >
          Listing Notes
        </label>
        <textarea
          id="staging-directives"
          value={rawDirectives}
          onChange={(e) => setRawDirectives(e.target.value)}
          placeholder="Describe the key staging priorities and changes needed for this room..."
          rows={4}
          maxLength={2000}
          className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-stone-500 resize-none"
        />
      </div>

      <Button
        onClick={handleGenerate}
        disabled={isGenerating || !rawDirectives.trim()}
        title={!rawDirectives.trim() ? "Enter staging directives above to enable copy generation" : undefined}
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
      </Button>
      {!rawDirectives.trim() && !isGenerating && (
        <p className="text-sm text-muted-foreground">
          Enter staging directives above to enable copy generation
        </p>
      )}

      {copy && (
        <div className="mt-6 p-4 bg-card rounded-lg border border-stone-200 space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Observed Challenge
            </h4>
            <p className="mt-1 text-foreground">{copy.observedChallenge}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Recommendation
            </h4>
            <p className="mt-1 text-foreground">{copy.recommendation}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Buyer Psychology
            </h4>
            <p className="mt-1 text-foreground">{copy.buyerPsychology}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Checklist
            </h4>
            <ul className="space-y-2">
              {copy.checklist.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <Badge
                    variant={
                      item.category === "DIY/Declutter"
                        ? "secondary"
                        : item.category === "Rental Inventory"
                          ? "outline"
                          : "default"
                    }
                  >
                    {item.category}
                  </Badge>
                  <Badge
                    variant={
                      item.priority === "Critical"
                        ? "destructive"
                        : item.priority === "High"
                          ? "warning"
                          : "success"
                    }
                  >
                    {item.priority}
                  </Badge>
                  <span className="text-foreground">{item.item}</span>
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
