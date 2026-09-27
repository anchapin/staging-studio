/**
 * Issue #1060: signature save state machine.
 *
 * The "Keep + Retry" recovery pattern (option (a) of the issue) tracks
 * whether the most recent signature POST failed. The parent
 * (consultation-report-client / signoff-page-client) renders an
 * inline retry UI when the machine ends up in the `failed` state.
 *
 * State transitions:
 *   idle    ──save(dataUrl)──> saving
 *   saving  ──POST ok─────> signed (terminal — clear pendingDataUrl)
 *   saving  ──POST failed─> failed (store pendingDataUrl for retry)
 *   failed  ──retry───────> saving (re-POST with pendingDataUrl)
 *   failed  ──discard────> idle (clear pendingDataUrl + error)
 *
 * Pure helper so the test harness doesn't need a DOM (the project
 * doesn't ship @testing-library/react — see tests/inpaint-retry.test.ts
 * for the same convention applied to useInpaintStatus's retry core).
 */

export type SignatureSaveState =
  | { kind: "idle"; pendingDataUrl: null; error: null }
  | { kind: "saving"; pendingDataUrl: string | null; error: null }
  | { kind: "signed"; pendingDataUrl: null; error: null }
  | {
      kind: "failed";
      pendingDataUrl: string;
      error: string;
    };

/** Copy returned by `submitSignature` on a server failure. */
export function signatureSaveFailureMessage(
  fallbackMessage: string | undefined
): string {
  // Issue #1060: surface a plain-language lead-in before the server
  // copy so the user understands the canvas is still live and they can
  // retry without redrawing. The trailing error message is verbatim
  // from the server (e.g. "Save failed", "Invalid token", etc.).
  if (!fallbackMessage) {
    return "We couldn't save your signature. Please try again.";
  }
  return fallbackMessage;
}

/** Initial state — no signature yet. */
export function initialSignatureSaveState(): SignatureSaveState {
  return { kind: "idle", pendingDataUrl: null, error: null };
}

/**
 * Drives the state machine in response to a lifecycle event. Returns
 * the next state without mutation.
 *
 * `events.save` / `events.retry` carry the dataURL to POST. `events.ok`
 * and `events.fail` resolve the in-flight save. `events.discard` is
 * the user clearing a failed state to redraw.
 */
export type SignatureSaveEvent =
  | { kind: "save"; dataUrl: string }
  | { kind: "retry" }
  | { kind: "ok" }
  | { kind: "fail"; error: string }
  | { kind: "discard" };

export function nextSignatureSaveState(
  state: SignatureSaveState,
  event: SignatureSaveEvent
): SignatureSaveState {
  switch (event.kind) {
    case "save": {
      // A fresh save is only legal from idle (a fresh signature) or
      // from failed (the user clicked "Sign & Approve" again after
      // discarding the prior failure). Re-entrant save() while saving
      // is a no-op (no double-fire). From signed, the project is
      // already immutable per /api/sign-project's ALREADY_SIGNED
      // contract — the client should never attempt this.
      if (state.kind === "saving") return state; // re-entrant guard
      if (state.kind === "signed") return state; // immutable
      return { kind: "saving", pendingDataUrl: event.dataUrl, error: null };
    }
    case "retry": {
      if (state.kind !== "failed") return state;
      return {
        kind: "saving",
        pendingDataUrl: state.pendingDataUrl,
        error: null,
      };
    }
    case "ok": {
      if (state.kind !== "saving") return state;
      return { kind: "signed", pendingDataUrl: null, error: null };
    }
    case "fail": {
      if (state.kind !== "saving") return state;
      const pendingDataUrl = state.pendingDataUrl ?? "";
      return { kind: "failed", pendingDataUrl, error: event.error };
    }
    case "discard": {
      if (state.kind !== "failed") return state;
      return { kind: "idle", pendingDataUrl: null, error: null };
    }
  }
}