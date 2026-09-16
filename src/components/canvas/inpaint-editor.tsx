"use client";

import { useState, useCallback } from "react";
import InpaintMaskCanvas from "./inpaint-mask-canvas";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { Loader2 } from "lucide-react";
import { useInpaintStatus } from "./use-inpaint-status";

interface InpaintEditorProps {
  roomId: string;
  imageUrl: string;
  aesthetic: string;
  promptDirectives: string;
  onInpaintComplete?: (resultImageUrl: string) => void;
}

export default function InpaintEditor({
  roomId: _roomId,
  imageUrl,
  aesthetic,
  promptDirectives,
  onInpaintComplete,
}: InpaintEditorProps) {
  void _roomId;
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const { toasts, showError, showSuccess, dismissToast } = useToast();

  const { isProcessing, statusText, start } = useInpaintStatus({
    onCompleted: onInpaintComplete,
    showSuccess,
    showError,
  });

  const handleInpaint = useCallback(async () => {
    if (!maskDataUrl) {
      showError("Please draw a mask on the image first.");
      return;
    }

    if (!imageUrl) {
      showError("No image available to edit.");
      return;
    }

    await start(async (signal) => {
      const startResponse = await fetch("/api/inpaint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          maskUrl: maskDataUrl,
          promptDirectives,
          aesthetic,
        }),
        signal,
      });

      const startData = await startResponse.json();

      if (!startResponse.ok) {
        throw new Error(startData.message || startData.error || "Failed to start inpainting");
      }

      return startData.requestId as string;
    });
  }, [maskDataUrl, imageUrl, promptDirectives, aesthetic, start, showError]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-medium text-stone-700 mb-2">Original Image</h4>
          <img
            src={imageUrl}
            alt="Original"
            className="w-full max-w-md rounded-lg border border-gray-300"
          />
        </div>
        <div>
          <h4 className="text-sm font-medium text-stone-700 mb-2">Mask</h4>
          <InpaintMaskCanvas
            width={512}
            height={512}
            initialMaskDataUrl={maskDataUrl}
            onMaskChange={setMaskDataUrl}
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleInpaint}
          disabled={isProcessing || !maskDataUrl}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
            transition-colors
            ${isProcessing || !maskDataUrl
              ? "bg-stone-300 text-stone-500 cursor-not-allowed"
              : "bg-stone-800 text-white hover:bg-stone-700"
            }
          `}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            "Apply Inpainting"
          )}
        </button>

        {isProcessing && statusText && (
          <span className="text-sm text-stone-600">{statusText}</span>
        )}
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
