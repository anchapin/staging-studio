"use client";

import { useEffect, useRef, useState } from "react";
import {
  MoreHorizontal,
  Undo2,
  Redo2,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  planVersionRestore,
  type VersionHistoryStackState,
  type VersionRestorePlan,
} from "@/lib/version-history-stack";
import { useVersionHistory, type InpaintVersion } from "./use-version-history";

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

const MAX_VISIBLE_PILLS = 10;

export default function VersionHistoryPills({
  roomId,
  variantSlot,
  activeResultUrl,
  onVersionChange,
}: VersionHistoryPillsProps) {
  const { versions, isLoading, loadVersions, restoreVersion } = useVersionHistory(
    roomId,
    variantSlot
  );
  const [stacks, setStacks] = useState<VersionHistoryStackState>({
    undoStack: [], // Stack of resultUrls for undo
    redoStack: [], // Stack of resultUrls for redo
    currentIndex: 0, // Index into versions array
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [animatingPill, setAnimatingPill] = useState(false);
  const { showSuccess, showError } = useToast();
  const menuRef = useRef<HTMLDivElement>(null);

  // Load versions from the shared hook; refetch when the room/slot (via
  // loadVersions' identity) or the active result changes, mirroring the
  // pre-#713 dep set. After a successful fetch, point currentIndex at the
  // active version (or 0 when it is absent from the list).
  useEffect(() => {
    void loadVersions().then((fetched) => {
      if (!fetched || !activeResultUrl) return;
      const idx = fetched.findIndex((v) => v.resultUrl === activeResultUrl);
      setStacks((prev) => ({ ...prev, currentIndex: idx >= 0 ? idx : 0 }));
    });
  }, [activeResultUrl, loadVersions]);

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

  /**
   * Runs one restore with optimistic stack updates and #699 rollback: the
   * plan is applied while the server call is in flight, and the pre-click
   * snapshot is re-applied verbatim when the server rejects the restore
   * (failure result or throw), so the pills never point at a version the
   * server never applied.
   */
  const runRestore = async (
    plan: VersionRestorePlan,
    version: InpaintVersion,
    snapshot: VersionHistoryStackState
  ) => {
    setStacks(plan.next);
    try {
      const result = await restoreVersion(version.id);
      if (result.success) {
        onVersionChange?.(version.resultUrl);
        showSuccess("Version restored");
        return;
      }
      showError(result.error ?? "Failed to restore version");
    } catch {
      showError("Failed to restore version");
    }
    setStacks(snapshot);
  };

  const versionUrls = versions.map((v) => v.resultUrl);

  const handleUndo = () => {
    const plan = planVersionRestore(
      stacks,
      versionUrls,
      { kind: "undo" },
      activeResultUrl ?? null
    );
    if (!plan) return;
    void runRestore(plan, versions[plan.targetIndex], stacks);
  };

  const handleRedo = () => {
    const plan = planVersionRestore(
      stacks,
      versionUrls,
      { kind: "redo" },
      activeResultUrl ?? null
    );
    if (!plan) return;
    void runRestore(plan, versions[plan.targetIndex], stacks);
  };

  const handlePillClick = (version: InpaintVersion, index: number) => {
    const plan = planVersionRestore(
      stacks,
      versionUrls,
      { kind: "direct", targetIndex: index },
      activeResultUrl ?? null
    );
    if (!plan) return;
    if (!window.confirm("Restore this version? This will update your current image.")) return;
    void runRestore(plan, version, stacks);
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
            const isActive = actualIndex === stacks.currentIndex;
            return (
              <button
                key={version.id}
                type="button"
                onClick={() => handlePillClick(version, actualIndex)}
                title={`Pass ${actualIndex + 1} — ${formatRelativeTime(version.createdAt)}`}
                className={`
                  relative h-7 px-2.5 rounded-full font-mono text-xs font-semibold transition-all
                  ${isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-muted"
                  }
                  ${animatingPill && i === visibleVersions.length - 1 ? "animate-new-pill" : ""}
                `}
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
        disabled={stacks.undoStack.length === 0}
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
        disabled={stacks.redoStack.length === 0}
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
