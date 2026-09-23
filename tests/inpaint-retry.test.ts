import { describe, expect, it } from "vitest";

import { InpaintPollError } from "@/lib/inpaint-polling";
import { resolveInpaintRetry } from "@/lib/inpaint-retry";

/**
 * Issue #698: Retry after a poll-phase failure must resume polling the
 * existing requestId, not resubmit a new paid fal job.
 *
 * `useInpaintStatus` has no DOM-environment test harness (no
 * @testing-library/react in the project), so per repo convention the
 * hook's retry-callback decision core is extracted as the pure helper
 * `resolveInpaintRetry` and pinned 1:1 here. The hook wiring is fixed:
 * the helper's `resume` result maps to re-polling the captured
 * requestId (the editor's resume-by-bare-requestId pattern — no second
 * POST), and `resubmit` maps to re-running the last submit closure
 * (POST /api/inpaint).
 */
describe("resolveInpaintRetry", () => {
  describe("poll-phase failures (InpaintPollError with captured requestId) → resume", () => {
    it("resumes the existing requestId after a max-attempts failure", () => {
      const action = resolveInpaintRetry(
        new InpaintPollError("max-attempts", "Inpainting did not complete within 30 attempts."),
        "req_123"
      );

      expect(action).toEqual({ kind: "resume", requestId: "req_123" });
    });

    it("resumes the existing requestId after a timeout failure", () => {
      const action = resolveInpaintRetry(
        new InpaintPollError("timeout", "Inpainting did not complete within 300 seconds."),
        "req_123"
      );

      expect(action).toEqual({ kind: "resume", requestId: "req_123" });
    });

    it("resumes the existing requestId after a terminal failure (no second billed job)", () => {
      const action = resolveInpaintRetry(
        new InpaintPollError("terminal", "The image editing process encountered an error."),
        "req_123"
      );

      expect(action).toEqual({ kind: "resume", requestId: "req_123" });
    });

    it("classifies an aborted poll error as resume (defensive; the hook returns early on abort)", () => {
      const action = resolveInpaintRetry(
        new InpaintPollError("aborted", "Polling was aborted."),
        "req_123"
      );

      expect(action).toEqual({ kind: "resume", requestId: "req_123" });
    });

    it("resumes with the exact failed run's requestId, not a previous one", () => {
      const action = resolveInpaintRetry(
        new InpaintPollError("timeout", "Inpainting did not complete within 300 seconds."),
        "req_second"
      );

      expect(action).toEqual({ kind: "resume", requestId: "req_second" });
      expect(action).not.toEqual({ kind: "resume", requestId: "req_first" });
    });
  });

  describe("submit-phase failures → resubmit", () => {
    it("resubmits when the POST failed before any requestId was captured", () => {
      const action = resolveInpaintRetry(new Error("Failed to submit inpainting request."), null);

      expect(action).toEqual({ kind: "resubmit" });
    });

    it("resubmits on a plain error even with a stale requestId from a previous run", () => {
      const action = resolveInpaintRetry(
        new TypeError("Network error during submit"),
        "req_stale_from_previous_run"
      );

      expect(action).toEqual({ kind: "resubmit" });
    });

    it("resubmits on a non-Error thrown value", () => {
      const action = resolveInpaintRetry("submit exploded", null);

      expect(action).toEqual({ kind: "resubmit" });
    });

    it("resubmits defensively when a poll error has no captured requestId", () => {
      // Cannot happen in the hook (the poller only runs after submit
      // resolves), but the fallback must be the explicit resubmit path.
      const action = resolveInpaintRetry(
        new InpaintPollError("timeout", "Inpainting did not complete within 300 seconds."),
        null
      );

      expect(action).toEqual({ kind: "resubmit" });
    });
  });
});
