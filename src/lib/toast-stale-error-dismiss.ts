/**
 * Issue #1053 — dismiss stale error toasts when a later operation succeeds.
 *
 * A failed run's error toast can sit stacked above the success toast of a
 * retry (see src/components/ui/toast.tsx:36, the auto-dismiss timer). When a
 * success lands, drop every currently-visible error toast from the same list
 * so the stack never visually contradicts the outcome. The reverse direction
 * is intentionally NOT applied: a new error does not dismiss a prior success
 * — the success is already truthful. Pinned by
 * tests/toast-stale-error-dismiss.test.ts.
 */

export type ToastStaleDismissType = "success" | "error" | "info";

export interface ToastStaleDismissEntry {
  type: ToastStaleDismissType;
}

/**
 * Return the toast list that should result from appending {@code incoming}
 * to {@code current}. When {@code incoming} is a success, every prior error
 * entry is dropped first; info and success entries are preserved verbatim.
 * Errors and infos never trigger the auto-dismiss side-effect.
 *
 * Pure — no DOM, no state mutation, no React.
 */
export function applyDismissErrorOnSuccess<
  T extends ToastStaleDismissEntry,
>(current: readonly T[], incoming: T): T[] {
  if (incoming.type === "success") {
    const withoutErrors = current.filter((entry) => entry.type !== "error");
    return [...withoutErrors, incoming];
  }
  return [...current, incoming];
}