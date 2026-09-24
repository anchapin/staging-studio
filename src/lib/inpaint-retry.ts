import { InpaintPollError } from "./inpaint-polling";

/** What the Retry affordance should do after an inpaint run failed. */
export type InpaintRetryAction =
  /** Re-poll the already-submitted request — no new billed fal job (issue #698). */
  | { kind: "resume"; requestId: string }
  /** Re-run the submit closure (`POST /api/inpaint`) — submit-phase failure only. */
  | { kind: "resubmit" };

/**
 * Decides how the Retry action recovers from a failed inpaint run.
 *
 * Purpose: pure decision core for `useInpaintStatus`'s retry callback
 * (issue #698), testable without a React renderer. A failure is
 * poll-phase when the error escaped `pollInpaintStatus` (an
 * {@link InpaintPollError} of any reason — `timeout`, `max-attempts`,
 * `terminal`, `aborted`) AND the submit already produced a requestId:
 * the job may still be running at fal, so retry must resume polling
 * that existing requestId instead of submitting a second billed job and
 * orphaning the first row mid-flight. Everything else — transport/HTTP
 * errors from the POST, `InpaintPollError` without a captured
 * requestId (defensive; the poller only runs after submit resolves) —
 * is treated as submit-phase and may re-run the submit closure.
 *
 * Side effects: none — pure function.
 *
 * @param error The error caught at the end of the failed run.
 * @param requestId The requestId captured when the run's submit phase
 *   succeeded (`null` when the run never got that far).
 * @returns The retry action: `{ kind: "resume", requestId }` re-polls
 *   the existing request; `{ kind: "resubmit" }` starts a new POST.
 */
export function resolveInpaintRetry(
  error: unknown,
  requestId: string | null
): InpaintRetryAction {
  if (requestId && error instanceof InpaintPollError) {
    return { kind: "resume", requestId };
  }
  return { kind: "resubmit" };
}
