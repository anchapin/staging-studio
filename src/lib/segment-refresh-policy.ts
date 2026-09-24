/**
 * Issue #748: post-completion refresh-detection billing policy.
 *
 * Every completed inpaint run used to trigger an automatic furnishings
 * re-detection over the freshly staged result — a guaranteed cache miss
 * (the staged image is a brand-new URL, so the `(image, concept)`
 * SegmentCache can never serve it). Each run therefore billed one SAM
 * 3.1 call — plus one gpt-4o-mini labeling call when instances decoded —
 * against `DAILY_SEGMENT_LIMIT` / `DAILY_LABEL_LIMIT`, even for users who
 * never touched instance selection on the result.
 *
 * Decision (issue #748, option 2 — lazy refresh): the billed call fires
 * only when the user explicitly asks for instances on the current base
 * image (Auto detect tab activation, the Select Regions tool, a concept
 * chip, or the "Detect furnishings" refresh affordance). Editor open and
 * user-driven source switches still auto-fire (the issue #202/#228
 * lifecycle); only the parent-driven post-completion rebase defers.
 *
 * Pure state machine — `inpaint-editor.tsx` owns the React wiring.
 */

/** Whether the billed concept auto-fire is authorized for a base image. */
export type SegmentRefreshStatus = "armed" | "lazy";

export interface SegmentRefreshState {
  /**
   * The base imageUrl detection is armed for. `null` = no base is
   * authorized (a fresh post-completion rebase, or no image yet).
   */
  armedUrl: string | null;
  /**
   * Set when the USER navigates sources (selector click or undo): the
   * next base image the parent resolves is pre-authorized, preserving
   * the issue #202/#228 source-switch auto-fire.
   */
  pendingUserNavigation: boolean;
  /**
   * Set when an inpaint run completes (persisted) and the parent is
   * about to rebase the editor onto the staged result: that base must
   * land LAZY — no billed refresh until an explicit user action.
   */
  pendingCompletionRebase: boolean;
}

export interface BaseImageChangeOutcome {
  /** Replacement state, or null when nothing changes (idempotent re-run). */
  nextState: SegmentRefreshState | null;
  /** Authorization for the resolved base. */
  status: SegmentRefreshStatus;
  /**
   * True when stale per-image detection UI state (displayed result,
   * instances, overlays, selections, labels) must be cleared because no
   * refresh is coming to replace it — masks detected on the previous
   * photo must never tint the new base.
   */
  resetStaleDetection: boolean;
}

/**
 * Issue #228: the editor-open auto-fire — the first base the editor
 * mounts with is armed (the empty string guards a not-yet-resolved prop).
 */
export function initialSegmentRefreshState(imageUrl: string): SegmentRefreshState {
  return {
    armedUrl: imageUrl || null,
    pendingUserNavigation: false,
    pendingCompletionRebase: false,
  };
}

/**
 * User clicked the source selector (or undo) — arm the NEXT base the
 * parent resolves (issue #202/#228 source-switch auto-fire). A pending
 * completion rebase is superseded: explicit navigation wins.
 */
export function markUserSourceNavigation(state: SegmentRefreshState): SegmentRefreshState {
  return { ...state, pendingUserNavigation: true, pendingCompletionRebase: false };
}

/**
 * An inpaint run completed and the parent will rebase the editor onto
 * the staged result (issue #748). The CURRENT base stays armed until the
 * rebase actually lands (no in-flight fetch is aborted); the new base
 * resolves lazy. A pending user navigation is superseded: the completion
 * is the later, more specific signal.
 */
export function markCompletionRebase(state: SegmentRefreshState): SegmentRefreshState {
  return { ...state, pendingUserNavigation: false, pendingCompletionRebase: true };
}

/**
 * Resolve the policy for the current base image. Runs on every base
 * change AND whenever the state itself changes (a completion rebase can
 * land without a URL change — a batch restage can persist the same
 * staged URL twice). Pure and idempotent: resolving an already-consumed
 * transition returns `nextState: null`.
 */
export function resolveBaseImageChange(
  state: SegmentRefreshState,
  imageUrl: string
): BaseImageChangeOutcome {
  if (!imageUrl) {
    // No base yet — nothing to authorize, nothing stale to clear.
    return { nextState: null, status: "lazy", resetStaleDetection: false };
  }
  if (state.pendingUserNavigation) {
    return {
      nextState: {
        armedUrl: imageUrl,
        pendingUserNavigation: false,
        pendingCompletionRebase: false,
      },
      status: "armed",
      resetStaleDetection: false,
    };
  }
  if (state.pendingCompletionRebase) {
    return {
      nextState: {
        armedUrl: null,
        pendingUserNavigation: false,
        pendingCompletionRebase: false,
      },
      status: "lazy",
      resetStaleDetection: true,
    };
  }
  if (state.armedUrl === imageUrl) {
    return { nextState: null, status: "armed", resetStaleDetection: false };
  }
  // A base change with no pending signal: a parent-driven rebase the
  // editor never marked (defensive) — treat it like a completion and
  // never bill it; only an explicit user action re-arms.
  return { nextState: null, status: "lazy", resetStaleDetection: true };
}

/** True when the billed auto-fire is authorized for this base right now. */
export function isSegmentDetectionArmed(
  state: SegmentRefreshState,
  imageUrl: string
): boolean {
  return !!imageUrl && state.armedUrl === imageUrl;
}

/**
 * Explicit user activation of the detection surface on the current base
 * (Auto detect tab, Select Regions tool, concept chip, refresh button) —
 * issue #748's authorized refresh. Arming an already-armed base is a
 * no-op (the hook's key dedupe + SegmentCache keep repeats free), and
 * arming with no image is ignored.
 */
export function armForCurrentBase(
  state: SegmentRefreshState,
  imageUrl: string
): SegmentRefreshState {
  if (!imageUrl || state.armedUrl === imageUrl) return state;
  return { ...state, armedUrl: imageUrl };
}
