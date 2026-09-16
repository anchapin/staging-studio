"use client";

import { useState, useRef } from "react";
import imageCompression from "browser-image-compression";
import { Upload, Loader2, X, ImageIcon } from "lucide-react";
import { getSignedUploadUrl, confirmRoomPhotoUpload } from "@/app/actions/room-photos";

interface RoomCanvasProps {
  roomId: string;
  projectId: string;
  imageUrl?: string | null;
  variantSlot?: 0 | 1;
  onUploadComplete?: (slot: 0 | 1, publicUrl: string) => void;
}

export default function RoomCanvas({
  roomId,
  projectId,
  imageUrl,
  variantSlot = 0,
  onUploadComplete,
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
        <div className="relative group">
          <img
            src={imageUrl}
            alt="Room"
            className="w-full h-64 object-cover"
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
          className="w-full h-64 flex flex-col items-center justify-center gap-3 text-stone-500 hover:text-stone-700 hover:bg-stone-200/50 transition-colors"
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
