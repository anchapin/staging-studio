/**
 * Issue #1340 — `<VersionStrip>` + Lookbook slot.
 *
 * Bronze "Lookbook" pill that the strip paints onto whichever version
 * is the current lookbook slot. Extracted as its own component so the
 * strip renders it as a child (test pinning for both the strip's
 * composition and the badge's standalone structural contract).
 *
 * Color source: the Atelier bronze/secondary palette (color-tokens.ts).
 * The Magic Patterns draft uses `bg-sage`; the issue body (#1340) and
 * the design's iteration history both chose the bronze tone as a
 * warmer, more in-palette alternative. Sage is reserved for the
 * "Lookbook" CTA's *active* state ("X is in the lookbook" inline line).
 */

interface LookbookBadgeProps {
  /** Optional override for the label text — defaults to "Lookbook". */
  label?: string;
}

/**
 * Bronze pill with a small `BookOpen` glyph and the "Lookbook" label.
 * Pinned by `tests/edit-room-lookbook-badge.test.tsx`.
 */
export function LookbookBadge({ label = "Lookbook" }: LookbookBadgeProps) {
  return (
    <span
      data-testid="lookbook-badge"
      className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-on-secondary"
    >
      <BookOpen className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

// Inline SVG glyph so the badge has zero icon-library dependencies.
// Mirrors the lucide-react `BookOpen` style at 12px — a 16×12 viewbox
// with the same stroke weight (1.75) the rest of the edit-room subtree
// uses (per the issue's "all icons come from the same family" rule).
function BookOpen({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" />
      <path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}
