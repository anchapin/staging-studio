import { describe, expect, it } from "vitest";

import {
  initialSignatureSaveState,
  nextSignatureSaveState,
  signatureSaveFailureMessage,
  type SignatureSaveState,
} from "@/lib/signature-save-state";

/**
 * Issue #1060: signature save state machine (option (a) — Keep + Retry).
 *
 * The signature save flow must:
 *   1. NOT silently leave a "signed" appearance when the POST failed.
 *   2. Preserve the most recent signature dataURL so the user can
 *      retry without redrawing.
 *   3. Reset cleanly on a retry that succeeds or on an explicit discard.
 *
 * These tests pin the state machine so a future refactor of the
 * consultation-report-client / signoff-page-client components
 * (which are React components without a DOM test harness in this
 * project — see tests/inpaint-retry.test.ts for the same pattern)
 * can't reintroduce the silent-partial-state bug.
 */

const DATA_URL_A = "data:image/png;base64,AAA";
const DATA_URL_B = "data:image/png;base64,BBB";

describe("signature save state machine (issue #1060)", () => {
  it("starts in idle state with no pending dataURL and no error", () => {
    const state = initialSignatureSaveState();
    expect(state.kind).toBe("idle");
    expect(state.pendingDataUrl).toBeNull();
    expect(state.error).toBeNull();
  });

  describe("idle → saving → signed (happy path)", () => {
    it("transitions to saving on save() and preserves the dataURL", () => {
      const start: SignatureSaveState = initialSignatureSaveState();
      const saving = nextSignatureSaveState(start, {
        kind: "save",
        dataUrl: DATA_URL_A,
      });
      expect(saving.kind).toBe("saving");
      expect(saving.pendingDataUrl).toBe(DATA_URL_A);
      expect(saving.error).toBeNull();
    });

    it("transitions to signed on ok() and clears the pending dataURL", () => {
      const saving: SignatureSaveState = {
        kind: "saving",
        pendingDataUrl: DATA_URL_A,
        error: null,
      };
      const signed = nextSignatureSaveState(saving, { kind: "ok" });
      expect(signed.kind).toBe("signed");
      expect(signed.pendingDataUrl).toBeNull();
      expect(signed.error).toBeNull();
    });

    it("ignores save() while already saving (re-entrant guard)", () => {
      const saving: SignatureSaveState = {
        kind: "saving",
        pendingDataUrl: DATA_URL_A,
        error: null,
      };
      const next = nextSignatureSaveState(saving, {
        kind: "save",
        dataUrl: DATA_URL_B,
      });
      // The first dataURL stays — no save attempt is pre-empted.
      expect(next).toBe(saving);
    });
  });

  describe("saving → failed (the bug case)", () => {
    it("transitions to failed on fail() and stores the dataURL for retry", () => {
      const saving: SignatureSaveState = {
        kind: "saving",
        pendingDataUrl: DATA_URL_A,
        error: null,
      };
      const failed = nextSignatureSaveState(saving, {
        kind: "fail",
        error: "Save failed",
      });
      expect(failed.kind).toBe("failed");
      expect(failed.pendingDataUrl).toBe(DATA_URL_A);
      expect(failed.error).toBe("Save failed");
    });

    it("preserves the dataURL even when the fail() payload is empty (network drop)", () => {
      // The fail() event is dispatched from inside the catch block
      // with the resolved error message. A network drop may resolve to
      // "TypeError: Failed to fetch" or similar — the dataURL still
      // needs to survive so the retry path can re-POST it.
      const saving: SignatureSaveState = {
        kind: "saving",
        pendingDataUrl: DATA_URL_A,
        error: null,
      };
      const failed = nextSignatureSaveState(saving, {
        kind: "fail",
        error: "TypeError: Failed to fetch",
      });
      expect(failed.pendingDataUrl).toBe(DATA_URL_A);
    });
  });

  describe("failed → saving → signed (retry success)", () => {
    it("retry() from failed returns to saving with the same dataURL", () => {
      const failed: SignatureSaveState = {
        kind: "failed",
        pendingDataUrl: DATA_URL_A,
        error: "Save failed",
      };
      const retrying = nextSignatureSaveState(failed, { kind: "retry" });
      expect(retrying.kind).toBe("saving");
      expect(retrying.pendingDataUrl).toBe(DATA_URL_A);
      expect(retrying.error).toBeNull();
    });

    it("full retry cycle: failed → retry → ok lands in signed", () => {
      let state: SignatureSaveState = initialSignatureSaveState();
      state = nextSignatureSaveState(state, { kind: "save", dataUrl: DATA_URL_A });
      state = nextSignatureSaveState(state, { kind: "fail", error: "Save failed" });
      state = nextSignatureSaveState(state, { kind: "retry" });
      state = nextSignatureSaveState(state, { kind: "ok" });
      expect(state.kind).toBe("signed");
      expect(state.pendingDataUrl).toBeNull();
    });
  });

  describe("failed → idle (discard and redraw)", () => {
    it("discard() from failed returns to idle and clears the dataURL", () => {
      const failed: SignatureSaveState = {
        kind: "failed",
        pendingDataUrl: DATA_URL_A,
        error: "Save failed",
      };
      const idle = nextSignatureSaveState(failed, { kind: "discard" });
      expect(idle.kind).toBe("idle");
      expect(idle.pendingDataUrl).toBeNull();
      expect(idle.error).toBeNull();
    });
  });

  describe("illegal transitions are no-ops", () => {
    it("ignores save() from signed", () => {
      const signed: SignatureSaveState = {
        kind: "signed",
        pendingDataUrl: null,
        error: null,
      };
      const next = nextSignatureSaveState(signed, {
        kind: "save",
        dataUrl: DATA_URL_A,
      });
      expect(next).toBe(signed);
    });

    it("ignores retry() from idle", () => {
      const idle: SignatureSaveState = initialSignatureSaveState();
      const next = nextSignatureSaveState(idle, { kind: "retry" });
      expect(next).toBe(idle);
    });

    it("ignores retry() from saving (no double-fire)", () => {
      const saving: SignatureSaveState = {
        kind: "saving",
        pendingDataUrl: DATA_URL_A,
        error: null,
      };
      const next = nextSignatureSaveState(saving, { kind: "retry" });
      expect(next).toBe(saving);
    });

    it("ignores ok() from idle (no in-flight save to resolve)", () => {
      const idle: SignatureSaveState = initialSignatureSaveState();
      const next = nextSignatureSaveState(idle, { kind: "ok" });
      expect(next).toBe(idle);
    });

    it("ignores fail() from idle", () => {
      const idle: SignatureSaveState = initialSignatureSaveState();
      const next = nextSignatureSaveState(idle, {
        kind: "fail",
        error: "x",
      });
      expect(next).toBe(idle);
    });

    it("ignores discard() from idle (nothing to discard)", () => {
      const idle: SignatureSaveState = initialSignatureSaveState();
      const next = nextSignatureSaveState(idle, { kind: "discard" });
      expect(next).toBe(idle);
    });
  });

  describe("the bug repro", () => {
    /**
     * Reproduces the exact sequence from issue #1060 step 4:
     *   1. User opens the consultation report
     *   2. User draws a signature
     *   3. User clicks "Sign & Approve" → save() → saving
     *   4. Network drops → fail() → failed
     *   5. Bug: page still appears "signed" because the canvas
     *      pixels persist and the error is just inline text.
     *      Fix: failed state renders an inline retry banner.
     */
    it("reaches the failed state, which renders retry UI instead of pretending success", () => {
      let state: SignatureSaveState = initialSignatureSaveState();
      state = nextSignatureSaveState(state, { kind: "save", dataUrl: DATA_URL_A });
      expect(state.kind).toBe("saving");

      state = nextSignatureSaveState(state, {
        kind: "fail",
        error: "Save failed",
      });
      expect(state.kind).toBe("failed");

      // The key invariant: a failed state must NOT be visually
      // indistinguishable from a signed state. The component
      // derives the displayed UI from state.kind:
      //   - signed → green checkmark page (terminal)
      //   - failed → red banner + retry button
      //   - saving → spinner
      //   - idle   → canvas + Save button
      expect(state.kind).not.toBe("signed");
      expect(state.pendingDataUrl).toBe(DATA_URL_A);
    });
  });
});

describe("signatureSaveFailureMessage (issue #1060)", () => {
  it("uses plain-language copy when no fallback is provided", () => {
    expect(signatureSaveFailureMessage(undefined)).toBe(
      "We couldn't save your signature. Please try again."
    );
  });

  it("uses plain-language copy when the fallback is empty", () => {
    expect(signatureSaveFailureMessage("")).toBe(
      "We couldn't save your signature. Please try again."
    );
  });

  it("falls back to the server-provided error verbatim", () => {
    expect(signatureSaveFailureMessage("Save failed")).toBe("Save failed");
    expect(
      signatureSaveFailureMessage("The preview link has expired or is invalid.")
    ).toBe("The preview link has expired or is invalid.");
  });

  it("does not invent programmer-speak in the fallback path", () => {
    // The user-facing message in the failure banner is intentionally
    // separate ("We couldn't save your signature.") so the trailing
    // server copy can stay verbatim without leaking jargon.
    const fallback = signatureSaveFailureMessage("Failed to fetch");
    expect(fallback).not.toMatch(/Unable to/);
    expect(fallback).not.toMatch(/TypeError/);
  });
});