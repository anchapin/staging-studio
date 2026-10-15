"use client";

/**
 * Issue #1337 — `<EditRoomStudio>` shell + scope/view state machine.
 * Issue #1339 — Mounts `<CanvasStage>` in the canvas slot.
 *
 * Top-level shell for the Edit Room UX redesign (Magic Patterns OS
 * `hVPYX2rJ2yawc1XTY2LTRJ`, design file `dVy8jC2kXpi1ca8b4A1hcS`).
 * This slice lands the shell + the state machine only — it does NOT
 * wire to a route (children #1340..#1342 fill in VersionStrip,
 * Inspector, StagePanel, FineTune, CopyPanel; #1344/#1345 wire to the
 * per-room view and the `/refine` route). The shell owns its state via
 * `useReducer` against `editRoomReducer` so the same transitions are
 * reachable from tests (see `tests/edit-room-reducer.test.ts`).
 *
 * NOT WIRED — the parent route is intentionally still the legacy
 * `InpaintEditor` until #1344 lands. This file is imported only by
 * tests + future slices; no production route uses it yet.
 */

import { useEffect, useMemo, useReducer, useRef } from "react";

import { resolveStageBlockedReason } from "@/lib/edit-room-blocked";
import { resolveTargetSlot, type SlotId } from "@/lib/edit-room-scope";

import { CanvasStage } from "@/components/edit-room/CanvasStage";
import { TopBar } from "@/components/edit-room/TopBar";
import { Toast } from "@/components/edit-room/Toast";
import {
  editRoomReducer,
  initialEditRoomState,
} from "@/components/edit-room/edit-room-reducer";
import type { EditRoomStudioProps } from "@/components/edit-room/types";

const TOAST_AUTO_DISMISS_MS = 3200;
const DIRECTIONS_DEBOUNCE_MS = 900;

export function EditRoomStudio({
  saveStatus: _saveStatus,
  onDirectionsCommit,
}: EditRoomStudioProps) {
  const [state, dispatch] = useReducer(editRoomReducer, initialEditRoomState);

  // ─── Derived state ─────────────────────────────────────────────────
  // `resolveTargetSlot` is the pure resolver pinned by
  // `tests/edit-room-scope.test.ts`. Until #1340 ships the version
  // strip, we treat the slot list as empty (so `viewing=original`
  // always falls back to `B`); the wiring is a #1340 change.
  const versions = useMemo(
    () => [
      { id: "original" as SlotId, url: null as string | null },
      { id: "A" as SlotId, url: null as string | null },
      { id: "B" as SlotId, url: null as string | null },
    ],
    []
  );
  const targetSlot = useMemo(
    () => resolveTargetSlot({ viewing: state.viewing, versions }),
    [state.viewing, versions]
  );

  // The Run-button blocker; #1342 reads this directly to render the
  // "blocked reason" copy under the primary action. The resolver is
  // pinned by `tests/edit-room-blocked.test.ts` (8 cases).
  const blockedReason = useMemo(
    () =>
      resolveStageBlockedReason({
        scope: state.scope,
        viewing: state.viewing,
        hasMask: state.hasMask,
        selectedCount: state.selected.length,
        hasDirections: state.directions.trim().length > 0,
      }),
    [
      state.scope,
      state.viewing,
      state.hasMask,
      state.selected.length,
      state.directions,
    ]
  );

  // ─── Side effects ──────────────────────────────────────────────────
  // 1. Toast auto-dismiss — mirrors App.tsx's `useEffect`. The timer
  //    is on `state.toast` so changing the message resets the
  //    dismiss countdown (the design's "fresh message bumps old one"
  //    semantics).
  useEffect(() => {
    if (!state.toast) return;
    const t = window.setTimeout(
      () => dispatch({ type: "DISMISS_TOAST" }),
      TOAST_AUTO_DISMISS_MS
    );
    return () => window.clearTimeout(t);
  }, [state.toast]);

  // 2. Directions debounce — the issue spec calls for 900ms. The
  //    reducer stores the verbatim text; this effect fires
  // `onDirectionsCommit` 900ms after the user stops typing. The
  //    parent route is responsible for the real persistence (#1344
  //    wires it to the existing AutosaveController).
  //
  // The `onDirectionsCommit` callback is held in a ref so a referentially
  // unstable parent (an inline lambda) does not reset the debounce timer
  // on every render — that would push the commit indefinitely into the
  // future. The `lastCommittedValue` guard makes the effect a no-op when
  // the value hasn't actually changed (mount + parent re-renders).
  const directionsTimer = useRef<number | undefined>(undefined);
  const lastCommittedValue = useRef<string>("");
  const onCommitRef = useRef(onDirectionsCommit);
  // Refs-as-latest-callback pattern (per React docs): keep the ref's
  // `.current` fresh in an effect, never during render. oxlint's
  // `react/refs` rule will flag the in-render assignment.
  useEffect(() => {
    onCommitRef.current = onDirectionsCommit;
  });
  useEffect(() => {
    if (state.directions === lastCommittedValue.current) return;
    window.clearTimeout(directionsTimer.current);
    directionsTimer.current = window.setTimeout(() => {
      lastCommittedValue.current = state.directions;
      onCommitRef.current(state.directions);
    }, DIRECTIONS_DEBOUNCE_MS);
    return () => window.clearTimeout(directionsTimer.current);
  }, [state.directions]);

  // The magic patterns layout: TopBar (breadcrumb+save), main column
  // (CanvasStage + VersionStrip), right column (Inspector), Toast.
  // Until the child slices land, the column bodies are empty
  // placeholders so the structural JSX shape is reviewable.
  return (
    <div
      data-testid="edit-room-studio"
      data-blocked-reason={blockedReason ?? ""}
      data-scope={state.scope}
      data-viewing={state.viewing}
      data-target-slot={targetSlot}
      data-compare={state.compare ? "true" : "false"}
      data-running={state.running === null ? "" : String(state.running)}
      className="flex h-screen flex-col overflow-hidden bg-surface text-ink"
    >
      {/* #1338 — TopBar (breadcrumb + room picker + save status) */}
      <TopBar
        address="418 Linden Ave"
        roomName="Living Room"
        projectId="proj-1"
        roomId="living"
        saveStatus={_saveStatus}
        onRoomChange={() => {
          /* #1340/#1344 wires the real room switcher */
        }}
        onExitToProject={() => {
          /* #1344 wires the project view's exit */
        }}
      />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col bg-surface-mid">
          {/* #1339 — CanvasStage + MaskLayer + CompareLayer + object boxes */}
          <section
            data-testid="edit-room-canvas"
            className="flex min-h-0 flex-1 flex-col"
            aria-label="Editing canvas"
          >
            <CanvasStage
              imageUrl={
                state.viewing === "original"
                  ? "/edit-room/original.jpg"
                  : state.viewing === "A"
                    ? "/edit-room/variant-a.jpg"
                    : "/edit-room/variant-b.jpg"
              }
              originalUrl="/edit-room/original.jpg"
              viewing={state.viewing}
              scope={state.scope}
              compare={state.compare}
              onToggleCompare={() => dispatch({ type: "TOGGLE_COMPARE" })}
              concept={state.concept}
              selected={state.selected}
              onToggleObject={(id) => dispatch({ type: "TOGGLE_OBJECT", objectId: id })}
              detections={
                state.concept === null
                  ? []
                  : [
                      { id: "obj-1", concept: state.concept, label: state.concept, box: { x: 49, y: 57, w: 31, h: 42 } },
                      { id: "obj-2", concept: state.concept, label: `${state.concept} 2`, box: { x: 8, y: 58, w: 23, h: 27 } },
                    ]
              }
              maskVersion={state.maskVersion}
              onMaskPainted={() => dispatch({ type: "MARK_MASK_PAINTED" })}
              onClearMask={() => dispatch({ type: "CLEAR_MASK" })}
              hasMask={state.hasMask}
              brushSize={state.brushSize}
              onBrushSizeChange={(n) => dispatch({ type: "SET_BRUSH_SIZE", size: n })}
              brushMode={state.brushMode}
              onBrushModeChange={(m) => dispatch({ type: "SET_BRUSH_MODE", mode: m })}
              running={state.running}
              targetSlot={targetSlot}
            />
          </section>

          {/* #1340 — VersionStrip + Lookbook slot */}
          <footer
            data-testid="edit-room-version-strip"
            className="border-t border-outline/15 bg-surface-container-low"
          >
            {/* Filled in by #1340 */}
          </footer>
        </main>

        {/* #1341 / #1342 — StagePanel + Inspector + primary Run button */}
        <aside
          data-testid="edit-room-inspector"
          className="w-[380px] shrink-0 border-l border-outline/15 bg-surface-container"
          aria-label="Staging inspector"
        >
          {/* Filled in by #1341 / #1342 */}
        </aside>
      </div>

      <Toast
        message={state.toast}
        onDismiss={() => dispatch({ type: "DISMISS_TOAST" })}
      />
    </div>
  );
}

// Re-exports so child slices can `import { editRoomReducer } from
// "@/components/edit-room/EditRoomStudio"` without re-importing the
// reducer module (and to keep the reducer co-located with its React
// surface — easier to grep when wiring later slices).
export { editRoomReducer, initialEditRoomState };