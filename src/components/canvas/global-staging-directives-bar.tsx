"use client";

import { useState } from "react";
import { Download, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STAGING_AESTHETICS } from "@/lib/staging-aesthetics";
import {
  WORKBENCH_DIRECTIVE_GRID_CLASSES,
  WORKBENCH_TOPBAR_SURFACE_CLASSES,
} from "@/lib/workbench-layout";
import { sliderFillStyle } from "@/lib/precision-slider";

/** Card chrome shared by the four directive cards (issue #620). */
const DIRECTIVE_CARD_CLASSES =
  "flex flex-wrap items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-low/50 px-3 py-2";

interface GlobalStagingDirectivesBarProps {
  /** Current design aesthetic selection */
  aesthetic: string;
  /** Called when the user changes the aesthetic */
  onAestheticChange: (aesthetic: string) => void;
  /** Currently locked architectural elements */
  lockedElements: string[];
  /** Called when adding a new locked element */
  onAddLock: (element: string) => void;
  /** Called when removing a locked element */
  onRemoveLock: (element: string) => void;
  /** Realism slider value 0-100 */
  realismValue: number;
  /** Called when realism slider changes */
  onRealismChange: (value: number) => void;
  /** Total number of rooms in the project */
  roomCount: number;
  /** Number of rooms currently being rendered */
  renderingCount: number;
  /** Whether GPU/cluster is active */
  gpuActive: boolean;
  /** Called when Start Batch is clicked */
  onStartBatch: () => void;
  /** Called when Auto-Regenerate All is clicked */
  onAutoRegenerateAll: () => void;
  /** Called when Export Batch is clicked */
  onExportBatch: () => void;
}

export default function GlobalStagingDirectivesBar({
  aesthetic,
  onAestheticChange,
  lockedElements,
  onAddLock,
  onRemoveLock,
  realismValue,
  onRealismChange,
  roomCount,
  renderingCount,
  gpuActive,
  onStartBatch,
  onAutoRegenerateAll,
  onExportBatch,
}: GlobalStagingDirectivesBarProps) {
  const [addLockInput, setAddLockInput] = useState("");
  const [showAddLock, setShowAddLock] = useState(false);

  const handleAddLock = () => {
    const trimmed = addLockInput.trim();
    if (trimmed && !lockedElements.includes(trimmed)) {
      onAddLock(trimmed);
    }
    setAddLockInput("");
    setShowAddLock(false);
  };

  return (
    <div
      className={`sticky top-0 z-20 flex flex-col gap-3 px-6 py-3.5 ${WORKBENCH_TOPBAR_SURFACE_CLASSES}`}
      aria-label="Global staging directives"
    >
      {/* Issue #620: 4 directive cards in a responsive grid —
          1 column mobile → 2 tablet → 4 desktop */}
      <div className={WORKBENCH_DIRECTIVE_GRID_CLASSES}>
        {/* Card 1: Design Aesthetic Preset */}
        <div className={DIRECTIVE_CARD_CLASSES}>
          <span className="text-sm text-muted-foreground">Design Aesthetic</span>
          <select
            value={aesthetic}
            onChange={(e) => onAestheticChange(e.target.value)}
            className="rounded-lg border border-border/40 bg-muted px-3 py-2 text-sm text-foreground"
            aria-label="Design aesthetic preset"
          >
            <option value="">Select aesthetic...</option>
            {STAGING_AESTHETICS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {/* Card 2: Architectural Preservation Lock */}
        <div className={DIRECTIVE_CARD_CLASSES}>
          <span className="text-sm text-muted-foreground">Preserve</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {lockedElements.map((element) => (
              <span
                key={element}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/70 px-2 py-0.5 text-xs text-foreground"
              >
                {element}
                <button
                  type="button"
                  onClick={() => onRemoveLock(element)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${element} lock`}
                >
                  ×
                </button>
              </span>
            ))}
            {showAddLock ? (
              <input
                type="text"
                value={addLockInput}
                onChange={(e) => setAddLockInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddLock();
                  if (e.key === "Escape") {
                    setShowAddLock(false);
                    setAddLockInput("");
                  }
                }}
                onBlur={handleAddLock}
                placeholder="Element name"
                className="w-28 rounded-full border border-border bg-muted/70 px-2 py-0.5 text-xs text-foreground placeholder:text-muted-foreground/50"
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowAddLock(true)}
                className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              >
                + Add
              </button>
            )}
          </div>
        </div>

        {/* Card 3: Realism & Lighting Lock */}
        <div className={DIRECTIVE_CARD_CLASSES}>
          <span className="text-sm text-muted-foreground">Realism &amp; Lighting</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Artistic</span>
            <input
              type="range"
              min={0}
              max={100}
              value={realismValue}
              onChange={(e) => onRealismChange(Number(e.target.value))}
              className="atelier-slider w-24"
              style={sliderFillStyle(realismValue, 0, 100)}
              aria-label="Realism and lighting slider"
            />
            <span className="font-mono text-xs text-foreground tabular-nums" aria-live="polite">
              {realismValue}%
            </span>
            <span className="text-xs text-muted-foreground">Photorealistic</span>
          </div>
        </div>

        {/* Card 4: Spatial Render Cluster */}
        <div className={DIRECTIVE_CARD_CLASSES}>
          <span className="text-sm text-muted-foreground">Render Status</span>
          <div className="flex items-center gap-1.5">
            {gpuActive ? (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-outline opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-outline" />
              </span>
            ) : (
              <span className="relative flex h-2 w-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-border" />
              </span>
            )}
            <span className="text-xs text-foreground">
              {gpuActive ? "GPU Active" : "GPU Idle"}
            </span>
            <span className="text-xs text-muted-foreground">
              {renderingCount > 0
                ? `Rendering: ${renderingCount}/${roomCount}`
                : `${roomCount} room${roomCount !== 1 ? "s" : ""}`}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onStartBatch}
            className="rounded-lg px-4 text-sm"
          >
            Start Batch
          </Button>
        </div>
      </div>

      {/* Right-side actions — below the directive grid, aligned right */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onAutoRegenerateAll}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-surface-container hover:text-foreground"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Auto-Regenerate All
        </button>
        <button
          type="button"
          onClick={onExportBatch}
          className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-container-low"
          aria-label="Export batch"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export Batch
        </button>
      </div>
    </div>
  );
}
