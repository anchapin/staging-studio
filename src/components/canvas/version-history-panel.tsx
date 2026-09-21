"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { getInpaintVersions, restoreInpaintVersion } from "@/app/actions/inpaint-versions";
import { useToast } from "@/components/ui/toast";

interface InpaintVersion {
  id: string;
  resultUrl: string;
  thumbnailUrl: string | null;
  seed: string | null;
  promptDirectives: string | null;
  createdAt: Date;
}

interface VersionHistoryPanelProps {
  roomId: string;
  /** Which variant slot to show versions for. */
  variantSlot: 0 | 1;
  /** The currently active (latest) result URL — highlighted in the grid. */
  activeResultUrl?: string | null;
  /** Called when a version is restored. */
  onRestored?: (resultUrl: string) => void;
}

function generateThumbnail(dataUrl: string, maxSize = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(maxSize / img.width, maxSize / img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = dataUrl;
  });
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

export default function VersionHistoryPanel({
  roomId,
  variantSlot,
  activeResultUrl,
  onRestored,
}: VersionHistoryPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [versions, setVersions] = useState<InpaintVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState<InpaintVersion | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const { showSuccess, showError } = useToast();

  const loadVersions = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getInpaintVersions(roomId, variantSlot);
      if (result.success) {
        setVersions(result.versions as InpaintVersion[]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [roomId, variantSlot]);

  useEffect(() => {
    if (isOpen) {
      void loadVersions();
    }
  }, [isOpen, loadVersions]);

  const handleRestore = async (version: InpaintVersion) => {
    setIsRestoring(true);
    try {
      const result = await restoreInpaintVersion(version.id);
      if (result.success) {
        showSuccess("Version restored successfully");
        onRestored?.(version.resultUrl);
        setPreviewUrl(null);
        setPreviewVersion(null);
        void loadVersions();
      } else {
        showError(result.error ?? "Failed to restore version");
      }
    } catch {
      showError("Failed to restore version");
    } finally {
      setIsRestoring(false);
    }
  };

  const handlePreview = (version: InpaintVersion) => {
    setPreviewVersion(version);
    setPreviewUrl(version.resultUrl);
  };

  return (
    <>
      {/* Collapsible trigger */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Version History
          {versions.length > 0 && (
            <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
              {versions.length}
            </span>
          )}
        </span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-stone-500" />
        ) : (
          <ChevronDown className="h-4 w-4 text-stone-500" />
        )}
      </button>

      {/* Collapsible content */}
      {isOpen && (
        <div className="flex flex-col gap-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
            </div>
          ) : versions.length === 0 ? (
            <p className="py-4 text-center text-sm text-stone-500">
              No previous versions yet.
            </p>
          ) : (
            <>
              {/* Thumbnail grid — 3 columns */}
              <div className="grid grid-cols-3 gap-2">
                {versions.map((version) => {
                  const isActive =
                    activeResultUrl === version.resultUrl;
                  return (
                    <button
                      key={version.id}
                      type="button"
                      onClick={() => handlePreview(version)}
                      className={`group relative aspect-square overflow-hidden rounded-md border-2 transition-all ${
                        isActive
                          ? "border-stone-800 ring-1 ring-stone-800"
                          : "border-stone-200 hover:border-stone-400"
                      }`}
                      title={`${formatRelativeTime(version.createdAt)}${version.seed ? ` · seed: ${version.seed}` : ""}`}
                    >
                      {version.thumbnailUrl ? (
                        <Image
                          src={version.thumbnailUrl}
                          alt={`Version from ${formatRelativeTime(version.createdAt)}`}
                          fill
                          className="object-cover"
                          sizes="80px"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-stone-100 text-xs text-stone-500">
                          <Clock className="h-4 w-4" />
                        </div>
                      )}
                      {/* Timestamp overlay */}
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1 py-1">
                        <span className="text-[10px] text-white">
                          {formatRelativeTime(version.createdAt)}
                        </span>
                      </div>
                      {isActive && (
                        <div className="absolute top-1 right-1 rounded bg-stone-800 px-1 py-0.5">
                          <span className="text-[9px] font-medium text-white">Latest</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {versions.length >= 20 && (
                <p className="text-xs text-stone-500 text-center">
                  Max {versions.length} versions stored. Oldest versions are removed when new ones are added.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Preview modal */}
      {previewUrl && previewVersion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Version preview"
          onClick={() => {
            setPreviewUrl(null);
            setPreviewVersion(null);
          }}
        >
          <div
            className="relative flex max-w-lg flex-col gap-4 rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-base font-semibold text-stone-800">
                  Version Preview
                </h3>
                <p className="text-xs text-stone-500">
                  {formatRelativeTime(previewVersion.createdAt)}
                  {previewVersion.seed && ` · seed: ${previewVersion.seed}`}
                </p>
                {previewVersion.promptDirectives && (
                  <p className="mt-1 text-xs text-stone-600 italic">
                    &ldquo;{previewVersion.promptDirectives}&rdquo;
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setPreviewUrl(null);
                  setPreviewVersion(null);
                }}
                className="shrink-0 rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Full-size preview image */}
            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-stone-100">
              <Image
                src={previewUrl}
                alt={`Version from ${formatRelativeTime(previewVersion.createdAt)}`}
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 512px"
              />
            </div>

            {/* Restore button */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void handleRestore(previewVersion)}
                disabled={isRestoring || activeResultUrl === previewVersion.resultUrl}
                className="flex items-center gap-2 rounded-md bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                {isRestoring ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                {activeResultUrl === previewVersion.resultUrl
                  ? "Currently active"
                  : "Restore this version"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Hook to generate a thumbnail from an image URL and expose it as a data URL.
 * Used by the parent to prepare the thumbnail before calling saveInpaintVersion.
 */
export async function generateThumbnailFromUrl(
  imageUrl: string,
  maxSize = 200
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      try {
        const scale = Math.min(maxSize / img.width, maxSize / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Image load failed for thumbnail"));
    img.src = imageUrl;
  });
}
