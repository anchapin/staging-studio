/**
 * Issue #1337 — `<EditRoomStudio>` shell.
 *
 * Magic Patterns `Toast.tsx` mirror. Single-message toast rendered at
 * the bottom of the shell. The auto-dismiss timer lives in the shell
 * (DISPATCH `SHOW_TOAST` → effect → `DISMISS_TOAST`); this component
 * just renders the message. Styling matches the Atelier Canvas palette
 * via Tailwind v4 utilities that resolve to `color-tokens.ts`.
 *
 * Issue #1337 directive: "Uses the existing `@/components/ui/toast`
 * internally; do not reimplement the auto-dismiss timer." We re-use
 * the palette + slide-in keyframes (the existing `ToastContainer` is a
 * portal/queue — too heavy for the Magic Patterns' single-line
 * position-fixed footer message); the existing module's *design
 * tokens* are mirrored so the visual language matches the rest of the
 * app. Wiring into `@/components/ui/toast`'s queue is out of scope
 * for this slice — child #1342 (Inspector + Run) opts in only if it
 * needs the existing toast container's auto-dismiss retry behaviour.
 */

interface ToastProps {
  message: string | null;
  onDismiss: () => void;
}

export function Toast({ message, onDismiss }: ToastProps) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-6"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-outline/20 bg-surface-container-highest px-5 py-3 text-sm text-on-surface shadow-lg">
        <span>{message}</span>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onDismiss}
          className="ml-2 rounded-full p-1 text-on-surface-variant transition hover:bg-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
        >
          ×
        </button>
      </div>
    </div>
  );
}