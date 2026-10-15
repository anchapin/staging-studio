/**
 * Issue #1342 — `<Inspector>` (380px right column shell).
 *
 * The Inspector wraps the two-tab tab strip + the StagePanel
 * (Staging tab) + a stub CopyPanel (Listing copy tab) + the primary
 * Run button footer. It is a pure function of props — the shell
 * (`EditRoomStudio`) owns all state via `useReducer` and threads
 * derived values down.
 *
 * Layout:
 *  ┌─────────────────────────────────┐
 *  │  [Staging]  [Listing copy]      │  ← tab strip
 *  ├─────────────────────────────────┤
 *  │                                 │
 *  │   <StagePanel> | <CopyPanel>    │  ← tab panel (fills available space)
 *  │                                 │
 *  ├─────────────────────────────────┤
 *  │   [   Stage whole room       ]  │  ← Run button footer (Staging only)
 *  │   "Result saves as Variant A"   │
 *  └─────────────────────────────────┘
 *
 * The Run button footer is hidden on the Listing copy tab because the
 * CopyPanel has its own footer in the design (rewritten in #1343).
 * Stacking the two footers would have the Run button launching an
 * inpaint run from a tab the user is reading listing-copy text on,
 * which is the opposite of the design's "tab is its own context" rule.
 *
 * The Inspector owns ONE piece of state: the active tab. Per the
 * issue body ("controlled mode"), the parent owns it via `activeTab` +
 * `onTabChange` so the shell can switch tabs from outside (e.g. when
 * a future "Generate copy" CTA appears in the canvas toolbar, it can
 * jump the user to the Listing copy tab). This is the same controlled-
 * mode pattern `<Collapsible>` uses.
 *
 * Out-of-scope (#1343 / #1344 wires it): the Fine-tune five controls'
 * real persistence + the CopyPanel's full content (just a stub here).
 *
 * Pinned by `tests/edit-room-inspector.test.tsx`.
 */

"use client";

import type { ReactNode } from "react";

import { CopyPanel } from "@/components/edit-room/CopyPanel";
import { StagePanel } from "@/components/edit-room/StagePanel";
import { RunButton } from "@/components/edit-room/run-button";
import { resolveRunLabel } from "@/lib/edit-room-run-label";
import { resolveHelperText } from "@/lib/edit-room-helper-text";
import type { DetectedObject } from "@/components/edit-room/detected-object-list";
import type { EditRoomScope, SlotId } from "@/lib/edit-room-scope";

/** The two tabs the Inspector exposes. */
export type InspectorTab = "stage" | "copy";

export interface InspectorProps {
  // ─── Staging-tab inputs (forwarded to <StagePanel>) ──────────────
  scope: EditRoomScope;
  onScopeChange: (s: EditRoomScope) => void;
  viewing: SlotId;
  onViewOriginal: () => void;
  targetSlot: SlotId;
  directions: string;
  onDirectionsChange: (v: string) => void;
  concept: string | null;
  onConceptChange: (c: string | null) => void;
  onConceptSubmit: (c: string) => void;
  selected: ReadonlyArray<string>;
  onToggleObject: (id: string) => void;
  onClearSelection: () => void;
  detections: ReadonlyArray<DetectedObject>;
  hasMask: boolean;
  onClearMask: () => void;
  projectAesthetic: string;
  projectGlobalDirectives: string;

  // ─── #1342 — Fine-tune controls (shell-owned, forwarded) ──────────
  // The Inspector doesn't care about the values; it just threads them
  // through to the StagePanel → FineTune so the shell can wire them
  // to the autosave controller in #1344.
  strength?: number;
  onStrengthChange?: (n: number) => void;
  adherence?: number;
  onAdherenceChange?: (n: number) => void;
  expand?: number;
  onExpandChange?: (n: number) => void;
  shadows?: boolean;
  onShadowsChange?: (b: boolean) => void;
  seed?: string;
  onSeedChange?: (s: string) => void;

  // ─── Inspector-owned (controlled) ─────────────────────────────────
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;

  // ─── Run button inputs (resolver-owned; the Inspector is dumb) ────
  /**
   * The blocked-resolver's return for the current (scope, viewing,
   * hasMask, hasSelection, hasDirections) tuple. Null means the run
   * is allowed. Owned by the parent (EditRoomStudio).
   */
  blockedReason: string | null;
  /** 0..100 while a run is in flight; null otherwise. */
  isRunning: boolean;
  /** Run progress (0..100). Ignored when `isRunning` is false. */
  progress: number;
  onRun: () => void;
}

export function Inspector(props: InspectorProps): ReactNode {
  const {
    // tab controls
    activeTab,
    onTabChange,
    // Run button inputs
    blockedReason,
    isRunning,
    progress,
    onRun,
    // StagePanel-forwarded
    scope,
    onScopeChange,
    viewing,
    onViewOriginal,
    targetSlot,
    directions,
    onDirectionsChange,
    concept,
    onConceptChange,
    onConceptSubmit,
    selected,
    onToggleObject,
    onClearSelection,
    detections,
    hasMask,
    onClearMask,
    projectAesthetic,
    projectGlobalDirectives,
    // Fine-tune pass-through (optional — defaults to StagePanel's
    // literal defaults when the shell hasn't wired them).
    strength,
    onStrengthChange,
    adherence,
    onAdherenceChange,
    expand,
    onExpandChange,
    shadows,
    onShadowsChange,
    seed,
    onSeedChange,
  } = props;

  // The Run button's label + loading state come straight from the
  // resolver — the Inspector never branches on its own.
  const { label, isLoading } = resolveRunLabel({
    scope,
    selectedCount: selected.length,
    viewing,
    isRunning,
    progress,
  });

  // The helper text under the Run button: blocked reason wins; otherwise
  // the (viewing, targetSlot) tuple produces "Result saves as…" or
  // "Touches up … in place".
  const helperText = resolveHelperText({
    viewing,
    targetSlot,
    blockedReason,
  });

  // The disabled flag for the Run button. While running, the button
  // is locked (the run is already in flight); the blocked reason also
  // disables it (per `resolveStageBlockedReason`).
  const isRunDisabled = isRunning || blockedReason !== null;

  return (
    <aside
      data-testid="edit-room-inspector"
      aria-label="Room editor"
      className="flex w-[380px] shrink-0 flex-col border-l border-line-soft bg-surface-container"
    >
      {/* ─── Tab strip (controlled) ─────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Editor sections"
        className="flex shrink-0 gap-6 border-b border-line-soft px-5"
      >
        {(
          [
            ["stage", "Staging"],
            ["copy", "Listing copy"],
          ] as const
        ).map(([id, label]) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`inspector-tab-${id}`}
              onClick={() => onTabChange(id)}
              className={
                "relative h-12 whitespace-nowrap text-sm font-semibold transition-colors duration-150 " +
                (active ? "text-ink" : "text-ink-subtle hover:text-ink-muted")
              }
            >
              {label}
              {active && (
                <span
                  data-testid="inspector-tab-underline"
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-walnut"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Tab panel (fills available space) ─────────────────────── */}
      {activeTab === "stage" ? (
        <>
          <StagePanel
            scope={scope}
            onScopeChange={onScopeChange}
            viewing={viewing}
            onViewOriginal={onViewOriginal}
            targetSlot={targetSlot}
            directions={directions}
            onDirectionsChange={onDirectionsChange}
            concept={concept}
            onConceptChange={onConceptChange}
            onConceptSubmit={onConceptSubmit}
            selected={selected}
            onToggleObject={onToggleObject}
            onClearSelection={onClearSelection}
            detections={detections}
            hasMask={hasMask}
            onClearMask={onClearMask}
            projectAesthetic={projectAesthetic}
            projectGlobalDirectives={projectGlobalDirectives}
            strength={strength}
            onStrengthChange={onStrengthChange}
            adherence={adherence}
            onAdherenceChange={onAdherenceChange}
            expand={expand}
            onExpandChange={onExpandChange}
            shadows={shadows}
            onShadowsChange={onShadowsChange}
            seed={seed}
            onSeedChange={onSeedChange}
          />
          <footer
            data-testid="inspector-staging-footer"
            className="shrink-0 border-t border-line-soft px-5 py-4"
          >
            <RunButton
              label={label}
              isLoading={isLoading}
              disabled={isRunDisabled}
              onRun={onRun}
              helperText={helperText}
            />
          </footer>
        </>
      ) : (
        <>
          <CopyPanel directions={directions} />
          <footer
            data-testid="inspector-copy-footer"
            className="shrink-0 border-t border-line-soft px-5 py-4"
          >
            {/* #1343 replaces this footer with the CopyPanel's own
                Rewrite-from-directions CTA. For now, a one-line
                "coming soon" placeholder so the layout matches the
                Staging tab's height (the Inspector is `flex flex-col`,
                so without a footer the CopyPanel stretches to fill). */}
            <p className="text-center text-xs text-ink-subtle">
              Listing copy rewrite is coming soon in #1343.
            </p>
          </footer>
        </>
      )}
    </aside>
  );
}