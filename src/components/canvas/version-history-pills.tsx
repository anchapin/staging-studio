"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MoreHorizontal,
  Undo2,
  Redo2,
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

interface VersionHistoryPillsProps {
  roomId: string;
  /** Which variant slot to show versions for. */
  variantSlot: 0 | 1;
  /** The currently active (latest) result URL — this is the "current" pill. */
  activeResultUrl?: string | null;
  /** Called when a version is restored/loaded. */
  onVersionChange?: (resultUrl: string) => void;
  /** Called when a new version is saved (inpaint completed). */
  onNewVersion?: () => void;
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

const MAX_VISIBLE_PILLS = 10;

export default function VersionHistoryPills({
  roomId,
  variantSlot,
  activeResultUrl,
  onVersionChange,
}: VersionHistoryPillsProps) {
  const [versions, setVersions] = useState<InpaintVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0); // Index into versions array
  const [undoStack, setUndoStack] = useState<string[]>([]); // Stack of resultUrls for undo
  const [redoStack, setRedoStack] = useState<string[]>([]); // Stack of resultUrls for redo
  const [menuOpen, setMenuOpen] = useState(false);
  const [animatingPill, setAnimatingPill] = useState(false);
  const { showSuccess, showError } = useToast();
  const menuRef = useRef<HTMLDivElement>(null);

  // Load versions from server
  const loadVersions = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getInpaintVersions(roomId, variantSlot);
      if (result.success) {
        const vers = result.versions as InpaintVersion[];
        setVersions(vers);
        // Set current index to the active version, or 0 if none
        if (activeResultUrl) {
          const idx = vers.findIndex((v) => v.resultUrl === activeResultUrl);
          setCurrentIndex(idx >= 0 ? idx : 0);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [roomId, variantSlot, activeResultUrl]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Watch for new versions: if activeResultUrl is not in versions, it's new → animate
  useEffect(() => {
    if (!activeResultUrl) return;
    const exists = versions.some((v) => v.resultUrl === activeResultUrl);
    if (!exists && versions.length > 0) {
      // New version was added - trigger animation and reload
      setAnimatingPill(true);
      setTimeout(() => setAnimatingPill(false), 400);
      void loadVersions();
    }
  }, [activeResultUrl, versions, loadVersions]);

  const handleRestore = async (version: InpaintVersion) => {
    try {
      const result = await restoreInpaintVersion(version.id);
      if (result.success) {
        // Add current to undo stack before restoring
        if (activeResultUrl) {
          setUndoStack((prev) => [...prev, activeResultUrl]);
        }
        // Clear redo stack on new action
        setRedoStack([]);
        // Update current index
        const idx = versions.findIndex((v) => v.id === version.id);
        if (idx >= 0) setCurrentIndex(idx);
        onVersionChange?.(version.resultUrl);
        showSuccess("Version restored");
      } else {
        showError(result.error ?? "Failed to restore version");
      }
    } catch {
      showError("Failed to restore version");
    }
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previousUrl = undoStack[undoStack.length - 1];
    const newUndoStack = undoStack.slice(0, -1);
    // Push current to redo stack
    if (activeResultUrl) {
      setRedoStack((prev) => [...prev, activeResultUrl]);
    }
    setUndoStack(newUndoStack);
    // Find the version with this URL and restore it
    const version = versions.find((v) => v.resultUrl === previousUrl);
    if (version) {
      const idx = versions.findIndex((v) => v.id === version.id);
      if (idx >= 0) setCurrentIndex(idx);
      void handleRestore(version);
    }
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const nextUrl = redoStack[redoStack.length - 1];
    const newRedoStack = redoStack.slice(0, -1);
    // Push current to undo stack
    if (activeResultUrl) {
      setUndoStack((prev) => [...prev, activeResultUrl]);
    }
    setRedoStack(newRedoStack);
    // Find the version with this URL and restore it
    const version = versions.find((v) => v.resultUrl === nextUrl);
    if (version) {
      const idx = versions.findIndex((v) => v.id === version.id);
      if (idx >= 0) setCurrentIndex(idx);
      void handleRestore(version);
    }
  };

  const handlePillClick = (version: InpaintVersion, index: number) => {
    if (index === currentIndex) return;
    // Add current to undo stack before switching
    if (activeResultUrl && activeResultUrl !== version.resultUrl) {
      setUndoStack((prev) => [...prev, activeResultUrl]);
    }
    // Clear redo stack on new action
    setRedoStack([]);
    setCurrentIndex(index);
    void handleRestore(version);
  };

  // Display versions in chronological order (oldest first = v1, v2, v3...)
  // versions from DB are newest first, so reverse for display
  const displayVersions = [...versions].reverse();
  const visibleVersions = displayVersions.slice(-MAX_VISIBLE_PILLS);
  const hasMore = versions.length > MAX_VISIBLE_PILLS;
  const offsetCount = versions.length - MAX_VISIBLE_PILLS;

  if (isLoading && versions.length === 0) {
    return null; // Don't show until first load
  }

  if (versions.length === 0) {
    return null; // Nothing to show
  }

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-full border shadow-lg"
      style={{
        backgroundColor: "rgba(248, 246, 242, 0.92)",
        backdropFilter: "blur(12px)",
        borderColor: "oklch(0.708 0 0 / 0.25)",
        boxShadow: "0 4px 24px -4px rgba(196, 120, 71, 0.18), 0 2px 8px rgba(24, 23, 22, 0.08)",
      }}
      role="region"
      aria-label="Version history"
    >
      {/* "Passes:" label */}
      <span className="text-xs text-muted-foreground shrink-0">Passes:</span>

      {/* Version pills */}
      <div className="flex items-center gap-1.5 overflow-hidden">
        {hasMore && (
          <span className="text-xs text-muted-foreground shrink-0">+{offsetCount}</span>
        )}
        <div className="flex items-center gap-1">
          {visibleVersions.map((version, i) => {
            const actualIndex = hasMore ? offsetCount + i : i;
            const isActive = actualIndex === currentIndex;
            return (
              <button
                key={version.id}
                type="button"
                onClick={() => handlePillClick(version, actualIndex)}
                className={`
                  relative h-7 px-2.5 rounded-full text-xs font-semibold transition-all
                  ${isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-muted"
                  }
                  ${animatingPill && i === visibleVersions.length - 1 ? "animate-new-pill" : ""}
                `}
                title={`Pass ${actualIndex + 1} — ${formatRelativeTime(version.createdAt)}`}
                style={{ fontFamily: "var(--font-jetbrains), monospace" }}
              >
                v{actualIndex + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Vertical divider */}
      <div
        className="w-px h-4 shrink-0"
        style={{ backgroundColor: "oklch(0.708 0 0 / 0.4)" }}
      />

      {/* Undo button */}
      <button
        type="button"
        onClick={handleUndo}
        disabled={undoStack.length === 0}
        className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title="Undo (previous version)"
        aria-label="Undo"
      >
        <Undo2 className="w-4 h-4 text-muted-foreground" />
      </button>

      {/* Redo button */}
      <button
        type="button"
        onClick={handleRedo}
        disabled={redoStack.length === 0}
        className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title="Redo (next version)"
        aria-label="Redo"
      >
        <Redo2 className="w-4 h-4 text-muted-foreground" />
      </button>

      {/* Vertical divider */}
      <div
        className="w-px h-4 shrink-0"
        style={{ backgroundColor: "oklch(0.708 0 0 / 0.4)" }}
      />

      {/* More options menu */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted transition-colors"
          title="More options"
          aria-label="More options"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
        </button>

        {menuOpen && (
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 py-1 w-44 rounded-md border shadow-md"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "oklch(0.708 0 0 / 0.2)",
            }}
          >
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
              style={{ color: "hsl(var(--card-foreground))" }}
              onClick={() => {
                setMenuOpen(false);
                // Could open a full version history view
                showSuccess("View all versions coming soon");
              }}
            >
              View All Versions
            </button>
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors"
              style={{ color: "hsl(var(--card-foreground))" }}
              onClick={() => {
                setMenuOpen(false);
                showSuccess("Compare versions coming soon");
              }}
            >
              Compare Versions
            </button>
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors text-destructive"
              onClick={() => {
                setMenuOpen(false);
                // Clear history would need confirmation
                showSuccess("Clear history coming soon");
              }}
            >
              Clear History
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes newPill {
          0% {
            opacity: 0;
            transform: scale(0.8);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-new-pill {
          animation: newPill 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
