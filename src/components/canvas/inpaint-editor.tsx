"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import InpaintMaskCanvas, { type SegmentMaskRequest } from "./inpaint-mask-canvas";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { Loader2 } from "lucide-react";
import { useInpaintStatus } from "./use-inpaint-status";
import {
  inpaintSourceLabel,
  inpaintSourcesEqual,
  type InpaintSource,
} from "@/lib/inpaint-source";
import {
  DEFAULT_MASK_EXPANSION_RADIUS,
  MAX_MASK_EXPANSION_RADIUS,
} from "@/lib/mask-dilation";
import HolisticSpikePanel from "./holistic-spike-panel";

interface InpaintEditorProps {
  roomId: string;
  /** The resolved source image the mask applies to (before photo or staged variant). */
  imageUrl: string;
  aesthetic: string;
  promptDirectives: string;
  /** The "after" slot this run's result will land in (resolved by the parent). */
  variantSlot: 0 | 1;
  /** Currently selected source; the parent owns this state (issue #170). */
  source: InpaintSource;
  /** Available source options (original photo + staged variants). */
  sourceOptions: InpaintSource[];
  onSourceChange?: (source: InpaintSource) => void;
  pendingRequestId?: string | null;
  /** Source of the pending run, reconstructed from its persisted row. */
  pendingSource?: InpaintSource | null;
  onInpaintComplete?: (resultImageUrl: string, source: InpaintSource) => void;
  /**
   * Full-width focused layout (issue #169): the mask canvas spans the
   * available content width instead of the compact card cap.
   */
  fullWidth?: boolean;
}

export default function InpaintEditor({
  roomId,
  imageUrl,
  aesthetic,
  promptDirectives,
  variantSlot,
  source,
  sourceOptions,
  onSourceChange,
  pendingRequestId,
  pendingSource,
  onInpaintComplete,
  fullWidth = false,
}: InpaintEditorProps) {
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
  // Issue #180: outward mask growth (in mask-canvas pixels) applied before
  // the mask is dispatched, so bezels/frames at the painted boundary are
  // regenerated too. 0 restores the un-dilated mask.
  const [maskExpansion, setMaskExpansion] = useState(DEFAULT_MASK_EXPANSION_RADIUS);
  const { toasts, showError, showSuccess, dismissToast } = useToast();

  // Click-to-segment state (issue #183): one in-flight SAM request at a
  // time; a successful response is handed to the mask canvas as a new
  // SegmentMaskRequest so it merges onto the existing grid.
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [segmentRequest, setSegmentRequest] = useState<SegmentMaskRequest | null>(null);
  const segmentRequestIdRef = useRef(0);

  // The source in effect for the CURRENT run, captured at start time so the
  // completion callback reports the right one even if the selector (or the
  // pending-request props) change while a run is in flight.
  const runSourceRef = useRef<InpaintSource>(pendingSource ?? source);

  const { isProcessing, statusText, start } = useInpaintStatus({
    onCompleted: (resultImageUrl) => onInpaintComplete?.(resultImageUrl, runSourceRef.current),
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
  // straight to polling the persisted requestId. The run's source comes from
  // the persisted row so completion persists with the original run's
  // semantics (issue #170).
  useEffect(() => {
    if (!pendingRequestId) return;
    runSourceRef.current = pendingSource ?? source;
    void start(async () => pendingRequestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume once per requestId, matching the pre-#170 behavior
  }, [pendingRequestId, start]);

  // Switching source swaps the image being edited — any existing mask was
  // drawn for the previous image and must not leak into the next run.
  const handleSourceChange = useCallback(
    (next: InpaintSource) => {
      if (inpaintSourcesEqual(next, source)) return;
      setMaskDataUrl(null);
      setSegmentRequest(null);
      onSourceChange?.(next);
    },
    [source, onSourceChange]
  );

  // Select Object (issue #183): sends the clicked point (already in the
  // photo's natural pixel space) plus the room reference to /api/segment.
  // On failure the error is surfaced and the canvas is left unchanged — a
  // segment response is only forwarded to the canvas on success.
  const handleSegmentSelect = useCallback(
    async (point: { x: number; y: number }) => {
      if (isProcessing || isSegmenting) return;
      if (!imageDims) {
        showError("The image is still loading. Please try again.");
        return;
      }
      setIsSegmenting(true);
      try {
        const response = await fetch("/api/segment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            imageUrl,
            point,
            imageWidth: imageDims.width,
            imageHeight: imageDims.height,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || "Failed to select the object.");
        }
        segmentRequestIdRef.current += 1;
        setSegmentRequest({
          id: segmentRequestIdRef.current,
          maskDataUrl: data.maskDataUrl,
        });
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Object selection failed. Please try again."
        );
      } finally {
        setIsSegmenting(false);
      }
    },
    [isProcessing, isSegmenting, imageDims, roomId, imageUrl, showError]
  );

  // Shared submit path for brush runs and holistic spike runs (issue
  // #190): both post the same body to /api/inpaint; holistic runs add
  // the negativePrompt override and swap mask/directives for the
  // strategy-generated ones.
  const beginInpaintRun = useCallback(
    async (run: { maskUrl: string; promptDirectives: string; negativePrompt?: string }) => {
      if (!imageUrl) {
        showError("No image available to edit.");
        return;
      }

      runSourceRef.current = source;

      await start(async (signal) => {
        const startResponse = await fetch("/api/inpaint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageUrl,
            maskUrl: run.maskUrl,
            promptDirectives: run.promptDirectives,
            negativePrompt: run.negativePrompt,
            aesthetic,
            roomId,
            variantSlot,
            sourceSlot: source.kind === "variant" ? source.slot : null,
          }),
          signal,
        });

        const startData = await startResponse.json();

        if (!startResponse.ok) {
          throw new Error(startData.message || startData.error || "Failed to start inpainting");
        }

        return startData.requestId as string;
      });
    },
    [imageUrl, aesthetic, roomId, variantSlot, source, start, showError]
  );

  const handleInpaint = useCallback(async () => {
    if (!promptDirectives.trim()) {
      showError("Please provide staging directives first.");
      return;
    }

    if (!maskDataUrl) {
      showError("Please draw a mask on the image first.");
      return;
    }

    await beginInpaintRun({ maskUrl: maskDataUrl, promptDirectives });
  }, [maskDataUrl, promptDirectives, beginInpaintRun, showError]);

  // Holistic spike entry (issue #190): the panel builds the full-room
  // mask + aesthetic-derived directives; this just forwards them into
  // the shared run launcher.
  const handleHolisticRun = useCallback(
    (run: { maskDataUrl: string; promptDirectives: string; negativePrompt: string }) => {
      void beginInpaintRun({
        maskUrl: run.maskDataUrl,
        promptDirectives: run.promptDirectives,
        negativePrompt: run.negativePrompt,
      });
    },
    [beginInpaintRun]
  );

  return (
    <div className="flex flex-col gap-6">
      {sourceOptions.length > 1 && (
        <fieldset className="rounded-md border border-stone-200 p-3">
          <legend className="px-1 text-sm font-medium text-stone-700">
            Edit from
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {sourceOptions.map((option) => (
              <label
                key={inpaintSourceLabel(option)}
                className="inline-flex cursor-pointer items-center gap-2 text-sm text-stone-700"
              >
                <input
                  type="radio"
                  name={`inpaint-source-${roomId}`}
                  value={inpaintSourceLabel(option)}
                  checked={inpaintSourcesEqual(option, source)}
                  disabled={isProcessing}
                  onChange={() => handleSourceChange(option)}
                  className="h-4 w-4 accent-stone-800"
                />
                {inpaintSourceLabel(option)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-medium text-stone-700 mb-2">Source Image</h4>
        <InpaintMaskCanvas
          overlayImageSrc={imageUrl}
          aspectRatio={aspectRatio}
          naturalWidth={imageDims?.width ?? null}
          naturalHeight={imageDims?.height ?? null}
          initialMaskDataUrl={maskDataUrl}
          onMaskChange={setMaskDataUrl}
          onSegmentSelect={handleSegmentSelect}
          segmentDisabled={isProcessing || isSegmenting}
          segmentMaskRequest={segmentRequest}
          expansionRadius={maskExpansion}
          fullWidth={fullWidth}
        />

        <label className="flex items-center gap-2 text-sm text-stone-700">
          Mask Expansion:
          <input
            type="range"
            min={0}
            max={MAX_MASK_EXPANSION_RADIUS}
            value={maskExpansion}
            onChange={(e) => setMaskExpansion(Number(e.target.value))}
            aria-describedby="mask-expansion-hint"
            className="w-32"
          />
          <span className="w-10 text-right">{maskExpansion}px</span>
        </label>
        <p id="mask-expansion-hint" className="text-xs text-gray-500">
          Grows the mask outward before submitting so frames, bezels, and
          mounts at the painted edge are replaced too. 0 keeps the mask
          exactly as painted.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleInpaint}
          disabled={isProcessing || isSegmenting || !maskDataUrl}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium
            transition-colors
            ${isProcessing || isSegmenting || !maskDataUrl
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

        {isSegmenting && (
          <span role="status" className="text-sm text-stone-600">
            Identifying the object you clicked...
          </span>
        )}
      </div>

      {/* Issue #190 spike entry — deliberately outside the main toolbar;
          issue #191 replaces this with the polished one-click preset. */}
      <details className="no-print rounded-md border border-dashed border-stone-300 p-3 text-sm">
        <summary className="cursor-pointer select-none text-stone-500">
          Holistic staging spike (#190) — internal testing only
        </summary>
        <div className="pt-3">
          <HolisticSpikePanel
            aesthetic={aesthetic}
            imageWidth={imageDims?.width ?? null}
            imageHeight={imageDims?.height ?? null}
            disabled={isProcessing || isSegmenting}
            onRun={handleHolisticRun}
            onError={showError}
          />
        </div>
      </details>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
