"use client";

import { useState, useRef } from "react";
import imageCompression from "browser-image-compression";
import { Upload, Loader2, X, ImageIcon } from "lucide-react";
import { getSignedUploadUrl, confirmRoomPhotoUpload } from "@/app/actions/room-photos";

interface RoomCanvasProps {
  roomId: string;
  projectId: string;
  imageUrl?: string | null;
}

export default function RoomCanvas({
  roomId,
  projectId,
  imageUrl,
}: RoomCanvasProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const options = {
        maxSizeMB: 10,
        maxWidthOrHeight: 2048,
        useWebWorker: true,
        onProgress: (percent: number) => setUploadProgress(percent),
      };

      const compressedFile = await imageCompression(file, options);

      setUploadProgress(50);

      const { signedUrl, storagePath } = await getSignedUploadUrl(
        roomId,
        compressedFile.name
      );

      setUploadProgress(70);

      const arrayBuffer = await compressedFile.arrayBuffer();
      const uploadResponse = await fetch(signedUrl, {
        method: "PUT",
        body: arrayBuffer,
        headers: {
          "Content-Type": compressedFile.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload image to storage");
      }

      setUploadProgress(90);

      await confirmRoomPhotoUpload(roomId, projectId, storagePath);

      setUploadProgress(100);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
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
            className="absolute inset-0 bg-stone-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            disabled={isUploading}
          >
            <Upload className="w-8 h-8 text-white" />
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
              <div className="w-48 h-1.5 bg-stone-300 rounded-full overflow-hidden mt-2">
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
        <div className="absolute top-2 right-2 bg-red-500 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
          <X className="w-3 h-3" />
          {error}
        </div>
      )}

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
