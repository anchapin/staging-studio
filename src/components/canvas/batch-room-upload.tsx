"use client";

import { useCallback, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import {
  Upload,
  Loader2,
  X,
  Sparkles,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  detectBatchRoomTypes,
  createRoomsBatch,
  getBatchRoomUploadUrls,
  type BatchRoomEntry,
} from "@/app/actions/room-batch";
import { useToast } from "@/components/ui/toast";

const ROOM_TYPE_LABELS = [
  "Living Room",
  "Primary Bedroom",
  "Secondary Bedroom",
  "Kitchen",
  "Dining Room",
  "Bathroom",
  "Home Office",
  "Garage",
  "Outdoor/Patio",
  "Other",
];

interface PendingFile {
  id: string;
  file: File;
  previewUrl: string;
  roomType: string;
  status: "pending" | "uploading" | "detecting" | "creating" | "done" | "error";
  error?: string;
  publicUrl?: string;
}

interface BatchRoomUploadProps {
  projectId: string;
  onRoomsCreated: () => void;
}

export default function BatchRoomUpload({
  projectId,
  onRoomsCreated,
}: BatchRoomUploadProps) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detectingAll, setDetectingAll] = useState(false);
  const [bulkOverride, setBulkOverride] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);
  const { showSuccess, showError } = useToast();

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const entries = Array.from(newFiles).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      roomType: "Other",
      status: "pending" as const,
    }));
    setFiles((prev) => [...prev, ...entries]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const entry = prev.find((f) => f.id === id);
      if (entry) URL.revokeObjectURL(entry.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const updateFile = useCallback((id: string, patch: Partial<PendingFile>) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
    );
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const items = e.dataTransfer.items;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        addFiles(imageFiles);
      }
    },
    [addFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (fileList && fileList.length > 0) {
        addFiles(fileList);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [addFiles]
  );

  const applyBulkRoomType = useCallback((roomType: string) => {
    setBulkOverride(roomType);
    setFiles((prev) =>
      prev.map((f) =>
        f.status === "pending" ? { ...f, roomType } : f
      )
    );
  }, []);

  const handleDetectAll = useCallback(async () => {
    const pending = files.filter((f) => f.status === "pending");
    if (pending.length === 0) return;

    setIsProcessing(true);
    setDetectingAll(true);

    // We need to first upload the images to get public URLs for AI detection
    // Step 1: Get signed URLs
    const fileNames = pending.map((f) => ({ name: f.file.name }));
    const urlResult = await getBatchRoomUploadUrls(projectId, fileNames);

    if (!urlResult.success) {
      showError(urlResult.error ?? "Failed to get upload URLs");
      setIsProcessing(false);
      setDetectingAll(false);
      return;
    }

    // Step 2: Upload files in parallel
    const uploadedUrls: Array<{ id: string; publicUrl: string }> = [];
    const uploadPromises = urlResult.uploads.map(async (upload) => {
      const pendingFile = pending[upload.roomIndex];
      if (!pendingFile) return;

      updateFile(pendingFile.id, { status: "uploading" });

      try {
        const options = {
          maxSizeMB: 10,
          maxWidthOrHeight: 2048,
          useWebWorker: true,
        };
        const compressed = await imageCompression(pendingFile.file, options);
        const buffer = await compressed.arrayBuffer();

        const response = await fetch(upload.signedUrl, {
          method: "PUT",
          body: buffer,
          headers: { "Content-Type": compressed.type },
        });

        if (!response.ok) {
          throw new Error("Upload failed");
        }

        // Derive public URL from signed URL (replace signed= with public)
        const publicUrl = upload.signedUrl.replace(
          /signed=.*$/,
          "public=true"
        );
        uploadedUrls.push({ id: pendingFile.id, publicUrl });
        updateFile(pendingFile.id, { status: "detecting", publicUrl });
      } catch (err) {
        updateFile(pendingFile.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    });

    await Promise.all(uploadPromises);

    // Step 3: Detect room types
    const toDetect = uploadedUrls.filter((u) => {
      const f = files.find((ff) => ff.id === u.id);
      return f?.status === "detecting";
    });

    if (toDetect.length > 0) {
      const detectResult = await detectBatchRoomTypes(
        projectId,
        toDetect.map((u) => u.publicUrl)
      );

      if (detectResult.success) {
        toDetect.forEach((upload, i) => {
          const detectedType = detectResult.roomTypes[i] ?? "Other";
          updateFile(upload.id, { roomType: detectedType });
        });
        setDetectingAll(false);
      } else {
        showError(detectResult.error ?? "Room type detection failed");
        // Fall back to "Other" for failed detections
        toDetect.forEach((upload) => {
          updateFile(upload.id, { roomType: "Other" });
        });
        setDetectingAll(false);
      }
    }

    setIsProcessing(false);
    setDetectingAll(false);
  }, [files, projectId, updateFile, showError]);

  const handleCreateRooms = useCallback(async () => {
    const toCreate = files.filter(
      (f) =>
        (f.status === "pending" || f.status === "detecting") && f.publicUrl
    );
    if (toCreate.length === 0) {
      showError("No uploaded rooms ready to create");
      return;
    }

    setIsProcessing(true);
    setFiles((prev) =>
      prev.map((f) =>
        toCreate.some((tc) => tc.id === f.id)
          ? { ...f, status: "creating" as const }
          : f
      )
    );

    const entries: BatchRoomEntry[] = toCreate.map((f) => ({
      fileName: f.file.name,
      roomType: f.roomType,
      beforeImageUrl: f.publicUrl!,
    }));

    const result = await createRoomsBatch(projectId, entries);

    if (result.success) {
      setFiles((prev) =>
        prev.map((f) =>
          toCreate.some((tc) => tc.id === f.id)
            ? { ...f, status: "done" as const }
            : f
        )
      );
      showSuccess(`${toCreate.length} room${toCreate.length > 1 ? "s" : ""} created`);
      onRoomsCreated();
    } else {
      setFiles((prev) =>
        prev.map((f) =>
          toCreate.some((tc) => tc.id === f.id)
            ? { ...f, status: "error" as const, error: result.error }
            : f
        )
      );
      showError(result.error ?? "Failed to create rooms");
    }

    setIsProcessing(false);
  }, [files, projectId, showSuccess, showError, onRoomsCreated]);

  const pendingCount = files.filter(
    (f) => f.status === "pending" || f.status === "uploading" || f.status === "detecting"
  ).length;
  const canCreate =
    files.length > 0 &&
    files.every((f) => f.status === "done" || (!!f.publicUrl && f.status !== "error"));

  return (
    <div className="flex flex-col gap-4">
      {/* Drop zone */}
      <div
        ref={dropzoneRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current?.click()}
        className="relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-stone-300 bg-stone-50 p-8 cursor-pointer hover:border-stone-400 hover:bg-stone-100 transition-colors"
        role="button"
        tabIndex={0}
        aria-label="Drop room photos here or click to browse"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileInput}
          className="hidden"
        />
        <Upload className="mb-3 h-10 w-10 text-stone-400" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">
          Drop room photos here, or click to browse
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload multiple photos at once — each room is auto-labeled with AI-detected room type
        </p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">
              {files.length} photo{files.length !== 1 ? "s" : ""} selected
            </h4>
            <div className="flex items-center gap-2">
              {/* Bulk room type override */}
              <select
                className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
                value={bulkOverride ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) applyBulkRoomType(val);
                  setBulkOverride(null);
                }}
                aria-label="Set room type for all pending photos"
              >
                <option value="">Set room type...</option>
                {ROOM_TYPE_LABELS.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>

              {/* Detect all */}
              <button
                type="button"
                onClick={() => void handleDetectAll()}
                disabled={
                  isProcessing ||
                  pendingCount === 0 ||
                  files.filter((f) => f.status === "pending").length === 0
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
              >
                {detectingAll ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Detecting...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    Detect room types
                  </>
                )}
              </button>

              {/* Create rooms */}
              <button
                type="button"
                onClick={() => void handleCreateRooms()}
                disabled={isProcessing || !canCreate}
                className="inline-flex items-center gap-1.5 rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-700 disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="h-3 w-3" aria-hidden="true" />
                    Create {pendingCount > 0 ? pendingCount : ""} room
                    {pendingCount !== 1 ? "s" : ""}
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {files.map((file) => (
              <div
                key={file.id}
                className="relative rounded-md border border-border bg-card overflow-hidden"
              >
                {/* Preview image */}
                <div className="relative aspect-[4/3] bg-stone-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={file.previewUrl}
                    alt={file.file.name}
                    className="h-full w-full object-cover"
                  />
                  {/* Status overlay */}
                  {(file.status === "uploading" ||
                    file.status === "detecting" ||
                    file.status === "creating") && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden="true" />
                    </div>
                  )}
                  {file.status === "done" && (
                    <div className="absolute inset-0 bg-green-600/40 flex items-center justify-center">
                      <Check className="h-6 w-6 text-white" aria-hidden="true" />
                    </div>
                  )}
                  {file.status === "error" && (
                    <div className="absolute inset-0 bg-red-600/40 flex items-center justify-center">
                      <AlertCircle className="h-6 w-6 text-white" aria-hidden="true" />
                    </div>
                  )}
                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => removeFile(file.id)}
                    className="absolute top-1 right-1 rounded-full bg-black/50 p-0.5 text-white hover:bg-black/70"
                    aria-label={`Remove ${file.file.name}`}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
                {/* File info */}
                <div className="p-2">
                  <p className="truncate text-xs font-medium text-foreground">
                    {(file.status === "uploading" || file.status === "detecting" || file.status === "creating") && (
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-secondary stage-pulse" aria-hidden="true" />
                    )}
                    {file.roomType}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {file.status === "pending" && "Pending"}
                    {file.status === "uploading" && "Uploading..."}
                    {file.status === "detecting" && "Detecting..."}
                    {file.status === "creating" && "Creating..."}
                    {file.status === "done" && "Ready"}
                    {file.status === "error" && (file.error ?? "Error")}
                  </p>
                </div>
                {/* Room type selector */}
                {file.status !== "done" && file.status !== "error" && (
                  <select
                    className="absolute bottom-2 left-2 right-2 rounded border border-black/20 bg-white/90 px-1 py-0.5 text-xs text-foreground"
                    value={file.roomType}
                    onChange={(e) =>
                      updateFile(file.id, { roomType: e.target.value })
                    }
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Room type for ${file.file.name}`}
                  >
                    {ROOM_TYPE_LABELS.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
