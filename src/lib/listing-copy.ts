/**
 * Issue #1343 — `resolveListingCopy` (lookbook page fallback resolver).
 *
 * The lookbook page (`/projects/[id]/lookbook`) and the print preview
 * (`/preview/[id]`) render the room's listing copy from the new
 * `lookbookHeadline` / `lookbookBody` columns when they are present,
 * and from the legacy `recommendation` field (the consultation-copy
 * "Our Approach" pillar) when the new columns are null. This module
 * is the single source of truth for the fallback decision so both
 * routes render the same data semantics and the resolution rule is
 * pinned by unit tests (no React, no Prisma).
 *
 * Rules pinned by `tests/listing-copy.test.ts`:
 *  - `null`, empty string, and whitespace-only strings are all
 *    "not set" — the resolver trims to decide presence but preserves
 *    the body verbatim once set.
 *  - When `lookbookHeadline` is set, it wins over the legacy field
 *    for the headline slot.
 *  - When `lookbookBody` is set, it wins over `recommendation` for
 *    the body slot. The legacy field is the fallback so a room that
 *    has never been opened in the new CopyPanel still shows up.
 *  - Whitespace inside a *set* body is preserved verbatim (the
 *    resolver trims *for the presence check*, not on output) — so
 *    a leading newline or intentional trailing space from the
 *    editor reaches the lookbook render untouched.
 *  - No I/O. Pure data transformation; never throws on missing keys.
 */

export interface ListingCopySources {
  /** Headline column on the Room (issue #1343). Null when unset. */
  lookbookHeadline: string | null;
  /** Body column on the Room (issue #1343). Null when unset. */
  lookbookBody: string | null;
  /** Legacy consultation-copy prose (issue #250). Null when unset. */
  recommendation: string | null;
}

export interface ResolvedListingCopy {
  /**
   * The headline to render in the lookbook. `null` when no source
   * (neither `lookbookHeadline` nor `recommendation`) has any
   * non-whitespace text — the render layer's signal to hide the
   * headline strip.
   */
  headline: string | null;
  /**
   * The body text to render in the lookbook. `null` when no source
   * has any non-whitespace text — the render layer's signal to
   * hide the body paragraph.
   */
  body: string | null;
}

/** Returns true when `value` is a present, non-blank string. */
function hasContent(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolves which copy the lookbook should render given the optional
 * new columns and the legacy `recommendation` fallback. Pure; same
 * inputs always produce the same output.
 */
export function resolveListingCopy(sources: ListingCopySources): ResolvedListingCopy {
  const headline = hasContent(sources.lookbookHeadline)
    ? (sources.lookbookHeadline as string)
    : null;
  // Body is preserved verbatim once set (so a leading newline or
  // trailing whitespace from the editor reaches the render), even
  // though the *presence check* trims.
  const body =
    typeof sources.lookbookBody === "string" && sources.lookbookBody.trim().length > 0
      ? sources.lookbookBody
      : sources.recommendation;
  return { headline, body };
}
