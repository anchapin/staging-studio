"use client";

/**
 * Issue #1344 (real `useInpaintRuns` wire) — small component that
 * owns the `useInpaintRuns` cluster for the new `<EditRoomStudio>`
 * surface. Mounted only when `isEditRoomRedesignEnabled` AND a focused
 * room is set, so the rules-of-hooks lint rule inside the file is
 * satisfied trivially (no early returns above this component).
 *
 * Why a separate component: the project detail view has multiple
 * early-return guards (loading, loadError, missing project). Calling
 * `useInpaintRuns` inside the route file after those guards trips
 * `react-hooks/rules-of-hooks` because the hook runs only on the
 * post-loading render path. Splitting the cluster into its own
 * component lets us mount it conditionally from JSX (which IS the
 * canonical React rule for hooks), and keeps the route file free of
 * the run-state plumbing.
 *
 * Returns nothing (a void component) — the parent reads the latest
 * values from the cluster via `useEffect`-driven callbacks
 * (`onRunningChange`, `onInpaintComplete`). The mask snapshot state
 * (`maskDataUrlByRoom`) lives in the parent because the studio's
 * `<MaskLayer>` fills it through the `onMaskChange` prop on every
 * stroke + CLEAR_MASK; this component only consumes it at submit
 * time, which the parent does by reading its state and calling the
 * legacy `<InpaintEditor>`-shaped submit path.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import {
  useInpaintRuns,
  type InpaintRunGuidance,
} from "@/components/canvas/use-inpaint-runs";
import {
  resolveInpaintTargetSlot,
  type InpaintSource,
  type InpaintSourceRoom,
} from "@/lib/inpaint-source";

/**
 * Structural subset of the focused `Room` row this cluster needs.
 * Mirrors what `useInpaintRuns` reads from the room — `id` for
 * routing, plus the four image columns `resolveInpaintTargetSlot`
 * consults when the source is the original photo.
 */
export type FocusedRoomLike = InpaintSourceRoom & { id: string };

/**
 * Imperative handle the cluster exposes via `ref`. The parent
 * reads the current `isProcessing` (for the running-overlay prop)
 * and calls `submitInpaint(maskDataUrl)` on Run clicks. `useImperativeHandle`
 * over a ref is the canonical pattern for components that own a
 * non-rendering side-effect (the cluster renders `null` — only its
 * `useEffect`s and `useInpaintRuns` internals matter).
 */
export interface EditRoomRunClusterHandle {
  /** True while a /api/inpaint round-trip is in flight. */
  isProcessing: boolean;
  /**
   * Submits a painted-area inpaint run. Returns the underlying
   * hook's promise; the parent awaits it for the success-path
   * branch (`editorBusy` flips back to false in `onInpaintComplete`).
   *
   * Pre-condition: any in-memory autosave the run depends on
   * (e.g. typed directives) must already be in the DB. Call
   * `beginRun` instead if you want the cluster to flush those
   * first.
   */
  submitInpaint: (maskDataUrl: string) => Promise<void>;
  /**
   * Issue #1361 — runs `beforeRun` (parent-supplied flush hook,
   * typically the directive autosave controller's `flush()`),
   * surfaces an error toast if `beforeRun` reports unsaved work
   * remained, and only then calls `submitInpaint`. Closes the
   * autosave race where a user types directives, clicks Run,
   * and the run submits with an empty `promptDirectives` string
   * because the 2 s autosave controller hadn't fired yet.
   *
   * Issue #1362b — runs `beforeSubmit` (parent-supplied mask
   * transform hook, typically `featherMask(maskDataUrl, expand)`
   * from `src/lib/mask-feather.ts`) BEFORE `beforeRun` flushes the
   * autosave. The transform returns a new mask data URL (or the
   * input unchanged when expand is 0) that the subsequent submit
   * uses. Failures surface as a Retry toast, mirroring the
   * directive-flush path.
   */
  beginRun: (maskDataUrl: string) => Promise<void>;
}

export interface EditRoomRunClusterProps {
  room: FocusedRoomLike;
  inpaintSource: InpaintSource;
  inpaintImageUrl: string;
  inpaintRoomDirectives: string;
  pendingRequestId: string | null;
  pendingSource: InpaintSource | null;
  inpaintProjectAesthetic: string;
  inpaintProjectGlobalDirectives: string;
  guidance: InpaintRunGuidance;
  /**
   * Called with the hook's `isProcessing` value on every change so
   * the parent can mirror it into `editorBusy` (browser-leave
   * guard, issue #1188) and derive the studio's controlled
   * `running` prop.
   */
  onRunningChange: (isProcessing: boolean) => void;
  onInpaintComplete: (
    resultImageUrl: string,
    runSource: InpaintSource
  ) => Promise<void> | void;
  showError: (
    message: string,
    retryable?: boolean,
    onRetry?: () => void,
    retryLabel?: string
  ) => void;
  showSuccess: (message: string) => void;
  /**
   * Issue #1361 — invoked by `beginRun` before `submitInpaint`
   * fires, so run-side-effect chain (typed directives →
   * `Room.rawDirectives`) is race-free. Resolves `true` when all
   * pending writes landed; `false` when unsaved work remains
   * (the cluster surfaces a toast via `showError` and skips
   * the submit so the run doesn't proceed on top of lost edits).
   */
  beforeRun?: () => Promise<boolean>;
  /**
   * Issue #1362b — invoked by `beginRun` BEFORE `beforeRun`, to
   * transform the user-painted mask data URL before submit. The
   * FineTune `expand` slider threads `featherMask(maskDataUrl, expand)`
   * through here (default: passthrough when expand === 0). Returns
   * the data URL the submit path should use; resolves to a
   * `Retry run` error toast on failure, mirroring `beforeRun`.
   */
  beforeSubmit?: (maskDataUrl: string) => Promise<string>;
}

/**
 * Mount-only cluster — no JSX. Owns the `useInpaintRuns` hook for
 * the new `<EditRoomStudio>` surface; the route file mounts it
 * conditionally (via the `isEditRoomRedesignEnabled` flag + a
 * focused-room check) so the rules-of-hooks lint rule is satisfied.
 */
export const EditRoomRunCluster = forwardRef<
  EditRoomRunClusterHandle,
  EditRoomRunClusterProps
>(function EditRoomRunCluster(props, ref) {
  const cluster = useInpaintRuns({
    roomId: props.room.id,
    variantSlot: resolveInpaintTargetSlot(props.room, props.inpaintSource),
    imageUrl: props.inpaintImageUrl,
    aesthetic: props.inpaintProjectAesthetic,
    promptDirectives: props.inpaintRoomDirectives.trim(),
    globalDirectives: props.inpaintProjectGlobalDirectives,
    source: props.inpaintSource,
    pendingRequestId: props.pendingRequestId,
    pendingSource: props.pendingSource,
    guidance: props.guidance,
    showError: props.showError,
    showSuccess: props.showSuccess,
    onInpaintComplete: async (resultImageUrl, runSource) => {
      await props.onInpaintComplete(resultImageUrl, runSource);
    },
    // Intentional no-ops (see `use-inpaint-runs.ts` header). The new
    // studio's strip + history panel are a follow-up slice; the
    // legacy completion path (`persistInpaintResult` +
    // `router.refresh`) handles variant rebasing for now.
    setActiveResultUrl: () => {},
    markRunCompletionRebase: () => {},
    batchSelections: [],
    unionMaskDataUrl: null,
    setBatchSelections: () => {},
    setSelectedInstanceIndices: () => {},
  });

  // Issue #1361 — flush autosave (parent-supplied) before
  // submitting, so `cluster.submitInpaint` reads directions the
  // user actually persisted (not an empty string the autosave
  // timer hadn't yet flushed). The Retry callback inside the
  // error toast re-enters the latest `beginRun` via a ref-stable
  // closure so the imperative handle's reference stays stable
  // across renders (oxlint's react-hooks rules don't allow
  // self-referential useCallback; this is the project-canonical
  // pattern — EditRoomStudio.tsx:442-444 uses the same shape
  // for `onCommitRef`).
  //
  // Issue #1362b — the `beforeSubmit` mask transform runs FIRST
  // (parent-supplied `featherMask(maskDataUrl, expand)`). The
  // pre-feather transform happens on the painted mask before any
  // network round-trip; failures surface as a Retry toast, mirroring
  // the directive-flush path below. When `beforeSubmit` is omitted
  // the original mask data URL reaches `submitInpaint` byte-equivalent.
  const beginRunRef = useRef<(maskDataUrl: string) => Promise<void>>(
    async () => {}
  );
  // Refresh the ref's current in an effect so oxlint's
  // `react/refs` rule (which forbids in-render `.current`
  // assignment) is satisfied. No dep array: re-runs every
  // render to capture the freshest props + cluster hook.
  useEffect(() => {
    beginRunRef.current = async (maskDataUrl: string): Promise<void> => {
      // Issue #1362b — mask feathering (FineTune `expand` slider)
      // happens FIRST. The pre-feather transform produces a new
      // mask data URL the submit path uses in place of the user's
      // painted one. When `beforeSubmit` is omitted or expand is 0,
      // `featherMask` returns the input unchanged.
      let submitMaskDataUrl = maskDataUrl;
      if (props.beforeSubmit) {
        try {
          submitMaskDataUrl = await props.beforeSubmit(maskDataUrl);
        } catch (featherError) {
          props.showError(
            "Couldn't prepare the mask for the provider — please retry in a moment.",
            true,
            () => {
              void beginRunRef.current(maskDataUrl);
            },
            "Retry run"
          );
          console.error(
            JSON.stringify({
              event: "inpaint_before_submit_failed",
              error:
                featherError instanceof Error
                  ? featherError.message
                  : String(featherError),
            }),
            featherError
          );
          return;
        }
      }
      if (props.beforeRun) {
        const flushed = await props.beforeRun();
        if (!flushed) {
          props.showError(
            "Couldn't save your directions before running — please retry in a moment.",
            true,
            () => {
              void beginRunRef.current(maskDataUrl);
            },
            "Retry run"
          );
          return;
        }
      }
      await cluster.submitInpaint(submitMaskDataUrl);
    };
  });

  useImperativeHandle(
    ref,
    () => ({
      isProcessing: cluster.isProcessing,
      submitInpaint: cluster.submitInpaint,
      beginRun: beginRunRef.current,
    }),
    [cluster.isProcessing, cluster.submitInpaint]
  );

  useEffect(() => {
    props.onRunningChange(cluster.isProcessing);
  }, [cluster.isProcessing, props]);

  return null;
});
