"use client";

/**
 * Issue #1337 — `<EditRoomStudio>` shell + scope/view state machine.
 * Issue #1339 — Mounts `<CanvasStage>` in the canvas slot.
 * Issue #1340 — Mounts `<VersionStrip>` + lookbook slot CTA beneath the canvas.
 * Issue #1342 — Mounts `<Inspector>` (two-tab Staging/Listing copy shell +
 *               primary Run button + helper text) in place of the bare
 *               StagePanel mount.
 *
 * Top-level shell for the Edit Room UX redesign (Magic Patterns OS
 * `hVPYX2rJ2yawc1XTY2LTRJ`, design file `dVy8jC2kXpi1ca8b4A1hcS`).
 * The shell owns its state via `useReducer` against `editRoomReducer`
 * so the same transitions are reachable from tests (see
 * `tests/edit-room-reducer.test.ts`). The Inspector's `activeTab` and
 * the FineTune five-control state are local `useState` because they
 * are not surfaced outside the studio yet (#1344 wires the FineTune
 * persistence to the autosave controller).
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { resolveStageBlockedReason } from "@/lib/edit-room-blocked";
import { resolveTargetSlot, type SlotId } from "@/lib/edit-room-scope";

import { CanvasStage } from "@/components/edit-room/CanvasStage";
import { Inspector, type InspectorTab } from "@/components/edit-room/Inspector";
import { TopBar } from "@/components/edit-room/TopBar";
import { Toast } from "@/components/edit-room/Toast";
import { VersionStrip } from "@/components/edit-room/VersionStrip";
import {
  editRoomReducer,
  initialEditRoomState,
} from "@/components/edit-room/edit-room-reducer";
import {
  assertLookbookPinnable,
} from "@/lib/lookbook-variant";
import type { EditRoomStudioProps, Version } from "@/components/edit-room/types";
import { setLookbookVariant } from "@/app/actions/lookbook-variant";
import { AutosaveController } from "@/lib/autosave-controller";
import { saveListingCopy } from "@/app/actions/room-copy";

const TOAST_AUTO_DISMISS_MS = 3200;
const DIRECTIONS_DEBOUNCE_MS = 900;

/** Fixed labels per the Magic Patterns design (Original photo / Variant A / Variant B). */
const SLOT_LABELS: Record<SlotId, string> = {
  original: "Original photo",
  A: "Variant A",
  B: "Variant B",
};

/** Placeholder image URLs the canvas reads (#1344 wires real `Room` rows). */
const PLACEHOLDER_URLS: Record<SlotId, string> = {
  original: "/edit-room/original.jpg",
  A: "/edit-room/variant-a.jpg",
  B: "/edit-room/variant-b.jpg",
};

export function EditRoomStudio({
  saveStatus: _saveStatus,
  onDirectionsCommit,
  projectId: _projectId,
  roomId,
  initialLookbookSlot,
  touchUps,
  initialCopyHeadline,
  initialCopyBody,
}: EditRoomStudioProps) {
  const [state, dispatch] = useReducer(editRoomReducer, initialEditRoomState);
  const router = useRouter();
  const [isLookbookPending, startLookbookTransition] = useTransition();

  // ─── Derived state ─────────────────────────────────────────────────
  // `resolveTargetSlot` needs the bare `{id,url}` shape. We derive it
  // from the same data source as the strip's `Version[]` so the target
  // slot the running overlay reports and the slot the strip highlights
  // as in-flight never disagree.
  const versions: Version[] = useMemo(
    () => [
      {
        id: "original" as const,
        label: SLOT_LABELS.original,
        url: PLACEHOLDER_URLS.original,
        touchUps: touchUps.original,
      },
      {
        id: "A" as const,
        label: SLOT_LABELS.A,
        // Placeholder until #1340's real Room read lands — the strip
        // marks empty slots with a "+" + "Empty" label.
        url: null,
        touchUps: touchUps.A,
      },
      {
        id: "B" as const,
        label: SLOT_LABELS.B,
        url: null,
        touchUps: touchUps.B,
      },
    ],
    [touchUps.original, touchUps.A, touchUps.B]
  );
  const targetSlot = useMemo(
    () => resolveTargetSlot({ viewing: state.viewing, versions }),
    [state.viewing, versions]
  );

  // The strip's `lookbookSlot` lives in its own state slot — derived
  // from `initialLookbookSlot` on mount, then mutated locally by the
  // CTA click. This avoids a reducer dispatch round-trip for a
  // server-driven value (the parent route's `router.refresh()` will
  // repaint on a navigation; for now the local `lookbookSlot` updates
  // immediately for snappy UI).
  const [lookbookSlot, setLocalLookbookSlot] = useState<SlotId>(initialLookbookSlot);

  // Reset the local lookbook slot when the parent route re-passes a
  // different `initialLookbookSlot` (e.g. after router.refresh). This
  // mirrors the React pattern for "treat props as initial values then
  // own them locally".
  useEffect(() => {
    setLocalLookbookSlot(initialLookbookSlot);
    // setLocalLookbookSlot is stable; the dep list deliberately tracks
    // only `initialLookbookSlot` (the source-of-truth).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLookbookSlot]);

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

  // ─── #1342 — Inspector state ──────────────────────────────────────
  // The Inspector is controlled: the shell owns `activeTab` and the
  // FineTune five values (local useState — they are not surfaced
  // outside the studio yet, so they don't need reducer discipline).
  // #1344 wires FineTune persistence to the autosave controller.
  const [activeTab, setActiveTab] = useState<InspectorTab>("stage");
  const [strength, setStrength] = useState(80);
  const [adherence, setAdherence] = useState(75);
  const [expand, setExpand] = useState(12);
  const [shadows, setShadows] = useState(true);
  const [seed, setSeed] = useState("");

  // ─── #1343 — CopyPanel state (Listing copy tab) ──────────────────
  // The CopyPanel mirrors the Room's persisted `lookbookHeadline` /
  // `lookbookBody` columns. The shell seeds from the parent route's
  // initial values (passed via EditRoomStudioProps), then mutates
  // locally on every keystroke — the debounced autosave then
  // persists back. The "Rewrite from directions" CTA dispatches a
  // local setTimeout that fills the inputs with placeholder rewrite
  // text; #1344 wires the real gpt-4o-mini call (or a parallel
  // /api/v1/listing-copy route once the schema lands).
  const [copyHeadline, setCopyHeadline] = useState(
    initialCopyHeadline
  );
  const [copyBody, setCopyBody] = useState(initialCopyBody);
  const [isCopyRewriting, setIsCopyRewriting] = useState(false);

  // Autosave controller for the two listing-copy columns. 600ms
  // idle window (per the issue's contract: "batches 600ms of
  // typing into one Prisma update"). The controller's `save`
  // callback calls `saveListingCopy`, which performs the
  // session + ownership + Zod validation server-side. A failed save
  // surfaces as the controller's `"error"` status; `flush()` would
  // resolve false so the future Export-PDF button can decide not to
  // ship over lost edits — same pattern as the directives
  // autosave controller in project-detail-view.tsx (#496).
  const copyAutosaveRef = useRef(
    new AutosaveController<{
      lookbookHeadline: string;
      lookbookBody: string;
    }>({
      save: async (payload) => {
        const result = await saveListingCopy(roomId, payload);
        return result.success;
      },
      idleMs: 600,
    })
  );
  // Keep the controller's status observable so the parent route's
  // save indicator (TopBar's "Saving…/Saved" pill) can reflect the
  // copy panel too. Today the indicator only reads directive status;
  // #1344 unifies both into one badge.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _copyAutosave = copyAutosaveRef.current;

  // The CopyPanel's two edit handlers both feed the same controller
  // so a headline edit + body edit within the 600ms window collapse
  // into one Prisma update (the controller's trailing-edge debounce
  // is typed-key agnostic). Each handler also bumps the panel's
  // local value so the textarea re-renders.
  const handleCopyHeadlineChange = useCallback((value: string) => {
    setCopyHeadline(value);
    copyAutosaveRef.current.edit({
      lookbookHeadline: value,
      lookbookBody: copyBodyRef.current,
    });
  }, []);
  const handleCopyBodyChange = useCallback((value: string) => {
    setCopyBody(value);
    copyAutosaveRef.current.edit({
      lookbookHeadline: copyHeadlineRef.current,
      lookbookBody: value,
    });
  }, []);

  // Refs-as-latest-state pattern (per #1342's rationale): the
  // captured callbacks above read the *latest* headline/body values
  // without depending on them in their deps arrays, so a keystroke
  // does not re-create the callback (which would force the panel's
  // input re-mount and reset the cursor).
  const copyHeadlineRef = useRef(copyHeadline);
  const copyBodyRef = useRef(copyBody);
  useEffect(() => {
    copyHeadlineRef.current = copyHeadline;
  });
  useEffect(() => {
    copyBodyRef.current = copyBody;
  });

  // The Rewrite-from-directions CTA stub (#1343 stub; #1344 wires
  // the real gpt-4o-mini call to a route returning {headline, body}).
  // The Magic Patterns design uses a 1.2s "Writing…" affordance
  // before the inputs animate to the new values — same shape as
  // the design, same interaction shape that the real call would
  // produce. The handler is mounted in a useCallback so the
  // Rewrite button's onClick ref is stable across renders.
  const handleCopyRewrite = useCallback(() => {
    if (isCopyRewriting) return;
    if (state.directions.trim().length === 0) return;
    setIsCopyRewriting(true);
    window.setTimeout(() => {
      setCopyHeadline(`Rewritten from your ${state.directions.length}-char brief`);
      setCopyBody(
        "Auto-generated placeholder: the AI rewrite of the listing copy lands in #1344."
      );
      setIsCopyRewriting(false);
    }, 1200);
  }, [isCopyRewriting, state.directions]);

  // The Run button's click handler — the inspector is dumb, the shell
  // owns the run-side-effect chain. For #1342 we only dispatch
  // RUN_START so the button's loading state engages; #1344 wires the
  // real inpaint submission (`/api/inpaint` + `useInpaintRuns`).
  const handleRun = useCallback(() => {
    if (blockedReason !== null || state.running !== null) return;
    dispatch({ type: "RUN_START" });
  }, [blockedReason, state.running]);

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

  // ─── #1340 — VersionStrip callbacks ─────────────────────────────────
  // Clicking a populated thumbnail switches the canvas view via
  // SET_VIEWING. The reducer clears compare + selected + mask as
  // side effects (per the design's "switching version resets overlay"
  // intent), so we don't need to dispatch anything else here.
  const handleSelectSlot = (slot: SlotId) => {
    dispatch({ type: "SET_VIEWING", viewing: slot });
  };

  // The CTA persists the local lookbook slot AND calls the server
  // action. We optimistically move the badge to the new slot so the
  // UI is snappy; a `router.refresh()` then pulls the canonical
  // value back from the server. The `useTransition` wrapper keeps the
  // whole surface responsive while the action runs.
  const handleUseInLookbook = (slot: SlotId) => {
    if (slot === "original") {
      // Defense in depth: the strip never invokes this with
      // "original", and the server action rejects it via
      // `assertLookbookPinnable`. The toast is the user-visible half
      // of that contract so a future API caller gets feedback.
      dispatch({
        type: "SHOW_TOAST",
        message: "Original photo cannot be pinned to the lookbook.",
      });
      return;
    }
    try {
      assertLookbookPinnable(slot);
    } catch {
      return;
    }
    setLocalLookbookSlot(slot);
    startLookbookTransition(async () => {
      const result = await setLookbookVariant(roomId, slot);
      if (!result.success) {
        dispatch({ type: "SHOW_TOAST", message: result.error });
        return;
      }
      // Pull the canonical `initialLookbookSlot` back so subsequent
      // server-driven renders agree with the local optimistic move.
      router.refresh();
    });
  };

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
      data-lookbook-slot={lookbookSlot}
      data-lookbook-pending={isLookbookPending ? "true" : "false"}
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
            <VersionStrip
              versions={versions}
              viewing={state.viewing}
              lookbookSlot={lookbookSlot}
              targetSlot={targetSlot}
              running={state.running !== null || isLookbookPending}
              onSelect={handleSelectSlot}
              onUseInLookbook={handleUseInLookbook}
            />
          </footer>
        </main>

        {/* #1342 — Inspector shell (two-tab Staging/Listing copy +
            primary Run button + helper text). The Inspector owns the
            tab UI; the shell owns the data + the run-side-effect
            chain (handleRun → /api/inpaint in #1344). */}
        <Inspector
          scope={state.scope}
          onScopeChange={(s) => dispatch({ type: "SET_SCOPE", scope: s })}
          viewing={state.viewing}
          onViewOriginal={() => dispatch({ type: "SET_VIEWING", viewing: "original" })}
          targetSlot={targetSlot}
          directions={state.directions}
          onDirectionsChange={(v) => dispatch({ type: "SET_DIRECTIONS", value: v })}
          concept={state.concept}
          onConceptChange={(c) => dispatch({ type: "SET_CONCEPT", concept: c })}
          onConceptSubmit={(c) => {
            // #1344 wires the real /api/segment/furnishings call;
            // for now we set the concept so the chips reflect the
            // typed value and the user sees the round-trip work.
            dispatch({ type: "SET_CONCEPT", concept: c });
          }}
          selected={state.selected}
          onToggleObject={(id) =>
            dispatch({ type: "TOGGLE_OBJECT", objectId: id })
          }
          onClearSelection={() => dispatch({ type: "CLEAR_SELECTION" })}
          detections={
            state.concept === null
              ? []
              : [
                  { id: "obj-1", concept: state.concept, label: state.concept, box: { x: 49, y: 57, w: 31, h: 42 } },
                  { id: "obj-2", concept: state.concept, label: `${state.concept} 2`, box: { x: 8, y: 58, w: 23, h: 27 } },
                ]
          }
          hasMask={state.hasMask}
          onClearMask={() => dispatch({ type: "CLEAR_MASK" })}
          projectAesthetic="Warm Craftsman Modern"
          projectGlobalDirectives="Keep original molding, hardwood floors and brick visible."
          strength={strength}
          onStrengthChange={setStrength}
          adherence={adherence}
          onAdherenceChange={setAdherence}
          expand={expand}
          onExpandChange={setExpand}
          shadows={shadows}
          onShadowsChange={setShadows}
          seed={seed}
          onSeedChange={setSeed}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          blockedReason={blockedReason}
          isRunning={state.running !== null}
          progress={state.running ?? 0}
          onRun={handleRun}
          // #1343 — CopyPanel wiring
          copyHeadline={copyHeadline}
          copyBody={copyBody}
          isCopyRewriting={isCopyRewriting}
          onCopyHeadlineChange={handleCopyHeadlineChange}
          onCopyBodyChange={handleCopyBodyChange}
          onCopyRewrite={handleCopyRewrite}
        />
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