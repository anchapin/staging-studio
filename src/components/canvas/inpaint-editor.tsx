"use client";

import { useState, useCallback, useEffect } from "react";
import InpaintMaskCanvas from "./inpaint-mask-canvas";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { Loader2 } from "lucide-react";
import { useInpaintStatus } from "./use-inpaint-status";

interface InpaintEditorProps {
  roomId: string;
  imageUrl: string;
  aesthetic: string;
  promptDirectives: string;
  variantSlot: 0 | 1;
  pendingRequestId?: string | null;
  onInpaintComplete?: (resultImageUrl: string) => void;
}

export default function InpaintEditor({
  roomId,
  imageUrl,
  aesthetic,
  promptDirectives,
  variantSlot,
  pendingRequestId,
  onInpaintComplete,
}: InpaintEditorProps) {
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
  const { toasts, showError, showSuccess, dismissToast } = useToast();

  const { isProcessing, statusText, start } = useInpaintStatus({
    onCompleted: onInpaintComplete,
    showSuccess,
    showError,
  });

  // Measure the source photo so the mask canvas can mirror its aspect ratio
  // and export masks at the photo's exact pixel dimensions.
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImageDims({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = imageUrl;
    return () => {
      img.onload = null;
    };
  }, [imageUrl]);

  const aspectRatio = imageDims ? imageDims.width / imageDims.height : null;

  // Resume an in-flight job (e.g. after a refresh): skip the submit and go
  // straight to polling the persisted requestId.
  useEffect(() => {
    if (!pendingRequestId) return;
    void start(async () => pendingRequestId);
  }, [pendingRequestId, start]);

  const handleInpaint = useCallback(async () => {
    if (!promptDirectives.trim()) {
      showError("Please provide staging directives first.");
      return;
    }

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
          roomId,
          variantSlot,
        }),
        signal,
      });

      const startData = await startResponse.json();

      if (!startResponse.ok) {
        throw new Error(startData.message || startData.error || "Failed to start inpainting");
      }

      return startData.requestId as string;
    });
  }, [maskDataUrl, imageUrl, promptDirectives, aesthetic, roomId, variantSlot, start, showError]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h4 className="text-sm font-medium text-stone-700 mb-2">Original Image</h4>
        <InpaintMaskCanvas
          overlayImageSrc={imageUrl}
          aspectRatio={aspectRatio}
          naturalWidth={imageDims?.width ?? null}
          naturalHeight={imageDims?.height ?? null}
          initialMaskDataUrl={maskDataUrl}
          onMaskChange={setMaskDataUrl}
        />
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
