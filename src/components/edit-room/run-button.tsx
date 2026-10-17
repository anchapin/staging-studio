/**
 * Issue #1342 — `<RunButton>` (primary Run button + helper text).
 *
 * The single Run button the Inspector renders below the StagePanel.
 * The component is purely presentational — the parent owns the label
 * (`resolveRunLabel`), the disabled flag (the blocked resolver),
 * the helper text (`resolveHelperText`), and the run handler. This
 * keeps the component trivially testable (no React hooks, no state)
 * and makes the wiring obvious in the parent.
 *
 * The button is the ONLY way the user launches an inpaint run from
 * the redesigned surface — every prior `onGenerate`/`handleHolisticRun`/
 * `handleBatchRun` path stays gated behind this one element (see the
 * parent epic #1336 acceptance criteria).
 *
 * Accessibility:
 *  - The button is a real `<button type="button">` so keyboard
 *    activation (Enter/Space) works without an explicit key handler.
 *  - When `disabled`, the button cannot be activated by Enter/Space
 *    (the browser blocks it). The helper text below doubles as the
 *    "why is this disabled" affordance.
 *  - The helper text wrapper carries `aria-live="polite"` so screen
 *    readers announce when it changes (e.g. directions-typed → ready).
 *  - The spinner is `aria-hidden` (decorative); the label carries the
 *    status ("Working… 42%") for assistive tech.
 *
 * Styling uses Atelier Canvas tokens via the Tailwind v4 utility
 * surface (`bg-walnut`, `text-walnut-foreground`, etc.) — see
 * `src/lib/color-tokens.ts` for the source of truth.
 *
 * Pinned by `tests/edit-room-run-button.test.tsx` (10 cases per the
 * issue body).
 */

"use client";

import { Loader2 } from "lucide-react";

export interface RunButtonProps {
  /** Resolved label text (`resolveRunLabel(...).label`). */
  label: string;
  /** Resolved loading flag (`resolveRunLabel(...).isLoading`). */
  isLoading: boolean;
  /**
   * Disabled flag — owned by the parent (the blocked resolver). When
   * true, the browser blocks keyboard activation AND the parent
   * should be calling `dispatch({type:"RUN_START"})` indirectly.
   */
  disabled: boolean;
  /** Click handler — parent wires it to the run-side-effect chain. */
  onRun: () => void;
  /** Helper text below the button (`resolveHelperText(...)`). */
  helperText: string;
}

/**
 * The Run button + helper text. Pure render — no state, no hooks.
 */
export function RunButton({
  label,
  isLoading,
  disabled,
  onRun,
  helperText,
}: RunButtonProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        data-testid="run-button"
        disabled={disabled}
        onClick={onRun}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-walnut px-4 text-sm font-semibold text-walnut-foreground transition-all duration-150 hover:bg-walnut/90 active:scale-[0.98] disabled:bg-surface-highest disabled:text-ink-subtle disabled:active:scale-100"
      >
        {isLoading && (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        )}
        <span>{label}</span>
      </button>
      <p
        data-testid="run-helper-text"
        aria-live="polite"
        className="text-center text-xs text-ink-subtle"
      >
        {helperText}
      </p>
    </div>
  );
}