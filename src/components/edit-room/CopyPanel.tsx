/**
 * Issue #1343 — `<CopyPanel>` (Listing copy tab).
 *
 * The CopyPanel replaces the #1342 stub. Two form fields — Headline
 * `<input>` + Description `<textarea>` with a 600-char counter —
 * plus one CTA ("Rewrite from directions") disabled while
 * `directions.trim()` is empty. All four inputs are controlled
 * (parent owns `headline` / `body` / `isRewriting`); the panel is a
 * pure function of those props plus the four callbacks.
 *
 * Why the parent owns the headline/body state (per the issue body):
 *  - The headline and body are local to the CopyPanel in spirit, but
 *    the shell (`EditRoomStudio`) wires an `AutosaveController` on
 *    top, so the shell needs to be in the callback path. Per the
 *    #1342 handoff, the panel is a controlled pure function of
 *    props; the shell mounts the autosave controller and passes the
 *    latest values back through `headline` / `body` so the panel
 *    always reflects persisted state. This pattern matches
 *    `<StagePanel>`'s `directions` prop from #1341.
 *
 * Accessibility:
 *  - Both inputs are real `<input>` / `<textarea>` paired with
 *    `<label htmlFor>` so screen readers announce them.
 *  - The 600-char counter carries `aria-live="polite"` so the
 *    announcement fires only on a quiet moment.
 *  - The Rewrite button is a real `<button type="button">` (Enter
 *    / Space activates it natively). When `isRewriting` is true it
 *    carries `aria-busy="true"` and a "Writing…" label so assistive
 *    tech announces the in-flight state.
 *
 * Out of scope (covered by other tests/surfaces):
 *  - The autosave-controller wiring (the shell does this).
 *  - The Inspector's mounting (`tests/edit-room-inspector.test.tsx`).
 *  - The lookbook render fallback (`tests/listing-copy.test.ts`).
 */

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export interface CopyPanelProps {
  /** Controlled value for the Headline `<input>`. */
  headline: string;
  /** Controlled value for the Description `<textarea>`. */
  body: string;
  /**
   * The shared staging-directions textarea content (threaded from
   * the Staging tab). Drives the "Rewrite from directions" CTA's
   * disabled state — empty disables it, since the AI rewrite needs
   * directions to brief from.
   */
  directions: string;
  /** True while a rewrite is in flight. Shows a spinner + "Writing…". */
  isRewriting: boolean;
  /**
   * Hard cap on body length. Defaults to 600 to match the issue's
   * Description counter contract. The `maxLength` HTML attribute
   * enforces it at the browser level so users cannot bypass it via
   * paste; the Zod-layer mirror lives in `listingCopySchema`.
   */
  bodyMaxLength?: number;
  /** Fires when the user edits the Headline input. */
  onHeadlineChange: (value: string) => void;
  /** Fires when the user edits the Description textarea. */
  onBodyChange: (value: string) => void;
  /** Fires when the user clicks "Rewrite from directions". */
  onRewrite: () => void;
}

const DEFAULT_BODY_MAX_LENGTH = 600;

export function CopyPanel(props: CopyPanelProps): ReactNode {
  const {
    headline,
    body,
    directions,
    isRewriting,
    bodyMaxLength = DEFAULT_BODY_MAX_LENGTH,
    onHeadlineChange,
    onBodyChange,
    onRewrite,
  } = props;

  // The Rewrite CTA depends on the trimmed directions — pin the
  // rule here so the parent never has to branch.
  const canRewrite = directions.trim().length > 0 && !isRewriting;
  // The counter never reports > bodyMaxLength (the textarea's HTML
  // maxLength would silently truncate a paste, so the displayed
  // count is always within range).
  const charCount = Math.min(body.length, bodyMaxLength);

  return (
    <div
      data-testid="copy-panel"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-6"
    >
      <header>
        <h2 className="font-playfair text-base font-semibold text-ink">
          Listing copy
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          Shown beside this room in the lookbook. Written from your
          staging directions and the selected version.
        </p>
      </header>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="copy-headline"
          className="text-xs font-semibold uppercase tracking-wider text-ink-subtle"
        >
          Headline
        </label>
        <input
          id="copy-headline"
          type="text"
          value={headline}
          onChange={(e) => onHeadlineChange(e.target.value)}
          placeholder="e.g. Bright &amp; airy living room with restored crown molding"
          className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus:border-walnut focus:outline-none focus:ring-2 focus:ring-walnut/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="copy-body"
            className="text-xs font-semibold uppercase tracking-wider text-ink-subtle"
          >
            Description
          </label>
          <p
            data-testid="copy-body-counter"
            aria-live="polite"
            className="text-xs tabular-nums text-ink-subtle"
          >
            {charCount} / {bodyMaxLength}
          </p>
        </div>
        <textarea
          id="copy-body"
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          maxLength={bodyMaxLength}
          rows={6}
          placeholder="One or two sentences that bring the room to life for a buyer…"
          className="w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:border-walnut focus:outline-none focus:ring-2 focus:ring-walnut/20"
        />
      </div>

      {/* Rewrite-from-directions CTA. Pinned by `data-testid` so the
          e2e suite can target it without relying on copy that may
          change. The button is disabled while `directions.trim()` is
          empty (the AI cannot rewrite from no brief) and while a
          rewrite is in flight (the AI is already working). */}
      <button
        type="button"
        data-testid="copy-rewrite-button"
        disabled={!canRewrite}
        aria-busy={isRewriting}
        onClick={onRewrite}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-walnut/30 bg-surface-mid px-4 text-sm font-semibold text-walnut transition-all duration-150 hover:bg-walnut/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-surface-mid"
      >
        {isRewriting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span>Writing…</span>
          </>
        ) : (
          <span>Rewrite from directions</span>
        )}
      </button>
    </div>
  );
}
