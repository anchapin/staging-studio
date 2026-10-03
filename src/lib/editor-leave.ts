/**
 * Issue #1188: leaving the edit staging view for the project overview.
 * Pure so the flush-and-confirm behaviour is unit-testable without a DOM.
 */

export const LEAVE_WHILE_RUNNING_MESSAGE =
  "A staging run is still in progress. If you leave now, its result may not be saved to this room. Leave anyway?";

export interface ConfirmLeaveEditorInput {
  /** True while an inpaint job is submitting or polling. */
  isProcessing: boolean;
  /** Usually `window.confirm`; injected for tests. */
  confirm: (message: string) => boolean;
  /**
   * The focused element, usually `document.activeElement`. Blurring it
   * flushes the buffered directives textarea (it commits on blur), so a
   * pending edit inside its 120 ms debounce window is saved first.
   */
  activeElement?: { blur?: () => void } | null;
}

/** Returns true when it is safe to leave the editor. */
export function confirmLeaveEditor({
  isProcessing,
  confirm,
  activeElement,
}: ConfirmLeaveEditorInput): boolean {
  activeElement?.blur?.();
  if (!isProcessing) return true;
  return confirm(LEAVE_WHILE_RUNNING_MESSAGE);
}

/** Browser-side convenience wrapper around confirmLeaveEditor. */
export function confirmLeaveEditorInBrowser(isProcessing: boolean): boolean {
  if (typeof window === "undefined") return true;
  return confirmLeaveEditor({
    isProcessing,
    confirm: (message) => window.confirm(message),
    activeElement: document.activeElement as { blur?: () => void } | null,
  });
}
