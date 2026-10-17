/**
 * Issue #1341 — `<ConceptChips>` (Objects-scope chip row + "Other…" search).
 *
 * Five hard-coded concept chips + an "Other…" search affordance. The
 * chips are "Sofa / Chair / Table / Rug / Lamp" — exactly the set the
 * Magic Patterns design surfaces (`dVy8` data.ts `CONCEPTS`). The
 * "Other…" input is a 64px-wide text field with a Search icon and a
 * form submit on Enter; the typed concept passes through to the shell
 * via `onConceptSubmit` and (on success) the field clears.
 *
 * Local state for the search text — the parent doesn't need to know
 * what's typed, only what got submitted. The clear-on-success is the
 * spec's UX: a submitted concept becomes a chip-style submission, the
 * search field empties for the next search.
 *
 * Pinned by `tests/edit-room-concept-chips.test.tsx` (#1341).
 */

"use client";

import { useState, type FormEvent, type ReactNode } from "react";

const CONCEPTS = ["Sofa", "Chair", "Table", "Rug", "Lamp"] as const;

export interface ConceptChipsProps {
  /** The active concept (drives `aria-pressed` on each chip). */
  concept: string | null;
  /** Fired when a chip is clicked; the chip's concept is passed through. */
  onConceptChange: (c: string) => void;
  /**
   * Fired on form submit (Enter inside the Other… input). Receives
   * the trimmed, non-empty value. The shell routes this through the
   * existing `/api/segment/furnishings` (#228) — no new server route
   * is added in this slice.
   */
  onConceptSubmit: (c: string) => void;
}

/**
 * Renders the chip row + the Other… search input. The form wrapper
 * handles the Enter-to-submit UX (a button-free submission model is
 * the design's choice — no visible submit button, just the Search
 * icon as the affordance).
 */
export function ConceptChips({
  concept,
  onConceptChange,
  onConceptSubmit,
}: ConceptChipsProps): ReactNode {
  const [other, setOther] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = other.trim();
    if (trimmed.length === 0) return;
    onConceptSubmit(trimmed);
    setOther("");
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {CONCEPTS.map((c) => {
        const active = concept === c;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={active}
            onClick={() => onConceptChange(c)}
            className={
              "h-7 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150 " +
              (active
                ? "border-walnut bg-walnut text-on-walnut"
                : "border-line-soft text-ink-muted hover:border-line hover:text-ink")
            }
          >
            {c}
          </button>
        );
      })}
      <form
        onSubmit={handleSubmit}
        className="flex h-7 items-center gap-1.5 rounded-md border border-line-soft px-2 focus-within:border-walnut"
      >
        <SearchIcon className="h-3 w-3 text-ink-subtle" aria-hidden />
        <input
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Other…"
          aria-label="Detect another object type"
          className="w-16 bg-transparent text-xs text-ink placeholder:text-ink-subtle focus:outline-none"
        />
      </form>
    </div>
  );
}

/** Inline `Search` glyph — keeps the chip row zero icon-library deps. */
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}