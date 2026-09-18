"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import imageCompression from "browser-image-compression";
import { Upload, Loader2, X, ImageIcon } from "lucide-react";
import { getSignedUploadUrl, confirmRoomPhotoUpload } from "@/app/actions/room-photos";

const ROOM_CANVAS_IMAGE_SIZES =
  "(max-width: 767px) calc(100vw - 320px), calc((100vw - 352px) / 2)";

/**
 * Focused-room layout (issue #169): the photo spans the full content width
 * (sidebar + page padding removed) instead of one half of the grid.
 */
const FOCUSED_ROOM_IMAGE_SIZES = "(max-width: 767px) calc(100vw - 320px), calc(100vw - 320px)";

interface RoomCanvasProps {
  roomId: string;
  projectId: string;
  imageUrl?: string | null;
  variantSlot?: 0 | 1;
  onUploadComplete?: (slot: 0 | 1, publicUrl: string) => void;
  /**
   * Focused-room layout (issue #169): span the full content width instead
   * of one half of the grid. Since #188 the frame height follows the
   * photo's aspect ratio (viewport-capped), so this only affects sizing.
   */
  largeImage?: boolean;
}

export default function RoomCanvas({
  roomId,
  projectId,
  imageUrl,
  variantSlot = 0,
  onUploadComplete,
  largeImage = false,
}: RoomCanvasProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    storagePath: string;
    slot: 0 | 1;
  } | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{
    signedUrl: string;
    storagePath: string;
    slot: 0 | 1;
    file: File;
  } | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  /**
   * Natural pixel dimensions of the loaded photo (issue #188). The frame
   * adopts the photo's own aspect ratio so the FULL image stays visible —
   * a fixed-height frame with `object-cover` cropped the bottom (and top)
   * off wide photos like the living-room hero shot. Null until the photo
   * loads; the fixed `frameHeight` fallback covers that window and the
   * empty/upload state.
   */
  const [imageAspect, setImageAspect] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Measure the source photo once it loads (same pattern as InpaintEditor)
  // so the frame can mirror its aspect ratio. `window.Image` — not the
  // imported next/image component — is the DOM constructor here.
  useEffect(() => {
    if (!imageUrl) return;
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImageAspect({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = imageUrl;
    return () => {
      img.onload = null;
    };
  }, [imageUrl]);

  const frameHeight = largeImage ? "h-96" : "h-64";
  const imageSizes = largeImage ? FOCUSED_ROOM_IMAGE_SIZES : ROOM_CANVAS_IMAGE_SIZES;

  const putToStorage = async (file: File, signedUrl: string) => {
    const arrayBuffer = await file.arrayBuffer();
    const uploadResponse = await fetch(signedUrl, {
      method: "PUT",
      body: arrayBuffer,
      headers: {
        "Content-Type": file.type,
      },
    });

    if (!uploadResponse.ok) {
      throw new Error("Failed to upload image to storage");
    }
  };

  const confirmUpload = async (storagePath: string, slot: 0 | 1) => {
    const confirmResult = await confirmRoomPhotoUpload(
      roomId,
      projectId,
      storagePath,
      slot
    );

    if (!confirmResult.success) {
      setError(confirmResult.error);
      setLiveMessage("Room photo upload failed.");
      return;
    }

    setPendingConfirm(null);
    setPendingUpload(null);
    setUploadProgress(100);
    setLiveMessage("Room photo upload complete.");
    onUploadComplete?.(slot, confirmResult.publicUrl);
  };

  const handleRetryLink = async () => {
    if (!pendingConfirm) return;

    setError(null);
    setLiveMessage("");
    setIsUploading(true);

    try {
      await confirmUpload(pendingConfirm.storagePath, pendingConfirm.slot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link upload");
      setLiveMessage("Room photo upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRetryUpload = async () => {
    if (!pendingUpload) return;

    const { signedUrl, storagePath, slot, file } = pendingUpload;

    setError(null);
    setLiveMessage("");
    setIsUploading(true);

    try {
      setUploadProgress(70);
      await putToStorage(file, signedUrl);

      setUploadProgress(90);
      setPendingUpload(null);
      setPendingConfirm({ storagePath, slot });
      await confirmUpload(storagePath, slot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload image to storage");
      setLiveMessage("Room photo upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setLiveMessage("");
    setIsUploading(true);
    setUploadProgress(0);
    setPendingConfirm(null);
    setPendingUpload(null);

    try {
      const options = {
        maxSizeMB: 10,
        maxWidthOrHeight: 2048,
        useWebWorker: true,
        onProgress: (percent: number) => setUploadProgress(percent),
      };

      const compressedFile = await imageCompression(file, options);

      setUploadProgress(50);

      const signedUrlResult = await getSignedUploadUrl(
        roomId,
        compressedFile.name,
        variantSlot
      );

      if (!signedUrlResult.success) {
        throw new Error(signedUrlResult.error);
      }

      const { signedUrl, storagePath } = signedUrlResult;

      setUploadProgress(70);
      setPendingUpload({
        signedUrl,
        storagePath,
        slot: variantSlot,
        file: compressedFile,
      });

      await putToStorage(compressedFile, signedUrl);

      setUploadProgress(90);
      setPendingConfirm({ storagePath, slot: variantSlot });
      await confirmUpload(storagePath, variantSlot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setLiveMessage("Room photo upload failed.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="relative rounded-lg border border-stone-200 bg-stone-100 overflow-hidden">
      {imageUrl ? (
        /* Issue #188: size the frame to the photo's own aspect ratio (with a
           viewport-height cap so portrait photos just scroll instead of
           towering) and letterbox with `object-contain` — never crop. The
           photo is the product and must be fully visible. */
        <div
          className={`relative group w-full overflow-hidden ${
            imageAspect ? "max-h-[70vh]" : frameHeight
          }`}
          style={
            imageAspect
              ? { aspectRatio: `${imageAspect.width} / ${imageAspect.height}` }
              : undefined
          }
        >
          <Image
            src={imageUrl}
            alt="Room"
            fill
            sizes={imageSizes}
            className="object-contain"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 bg-stone-900/50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white transition-opacity flex items-center justify-center"
            disabled={isUploading}
            aria-label="Replace room photo"
          >
            <Upload className="w-8 h-8 text-white" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileInputRef.current?.click()}
          className={`w-full ${frameHeight} flex flex-col items-center justify-center gap-3 text-stone-500 hover:text-stone-700 hover:bg-stone-200/50 transition-colors`}
          disabled={isUploading}
        >
          {isUploading ? (
            <>
              <Loader2 className="w-10 h-10 animate-spin" />
              <span className="text-sm font-medium">
                Uploading... {Math.round(uploadProgress)}%
              </span>
              <div
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(uploadProgress)}
                className="w-48 h-1.5 bg-stone-300 rounded-full overflow-hidden mt-2"
              >
                <div
                  className="h-full bg-stone-700 transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <ImageIcon className="w-10 h-10" />
              <span className="text-sm font-medium">Upload room photo</span>
              <span className="text-xs text-stone-400">
                Will be resized to max 2048px
              </span>
            </>
          )}
        </button>
      )}

      {error && (
        <div
          role="alert"
          className="absolute top-2 right-2 bg-red-500 text-white text-xs px-2 py-1 rounded flex items-center gap-1"
        >
          <X className="w-3 h-3" aria-hidden="true" />
          {error}
          {pendingConfirm && (
            <button
              onClick={() => void handleRetryLink()}
              disabled={isUploading}
              className="ml-1 underline hover:opacity-80 disabled:opacity-50"
            >
              Retry link
            </button>
          )}
          {!pendingConfirm && pendingUpload && (
            <button
              onClick={() => void handleRetryUpload()}
              disabled={isUploading}
              className="ml-1 underline hover:opacity-80 disabled:opacity-50"
            >
              Retry upload
            </button>
          )}
        </div>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
