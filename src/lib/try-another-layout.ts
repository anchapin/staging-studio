/**
 * "Try another layout" preset prompt builder (issue #1187).
 *
 * Riff on the architecture-first holistic directive (#223): same style,
 * same furnishings scope — only the ARRANGEMENT varies. Architecture
 * (walls, windows, flooring, ceiling, trim, doors) stays exactly as
 * photographed, so the result reads as the same room with a different
 * furniture placement rather than a different room. An optional short
 * nudge ("keep the sofa facing the fireplace") steers the arrangement
 * without rewriting the full directives.
 *
 * The architecture-preservation wording is borrowed verbatim from the
 * architecture-first variant in {@link buildHolisticDirectives} so the
 * two surfaces cannot drift apart on the constraints that matter.
 *
 * Pure string composition only; side effects: none.
 */

import { buildHolisticDirectives } from "./holistic-prompt";

/** Button label for the "Try another layout" action (issue #1187). */
export const TRY_ANOTHER_LAYOUT_LABEL = "Try another layout";

/** Max length for the user-supplied nudge. Trimmed to this bound silently. */
export const TRY_ANOTHER_LAYOUT_NUDGE_MAX = 200;

/**
 * The arrangement-variation sentence appended to the architecture-first
 * directive when the user clicks "Try another layout". Pinned by
 * `tests/try-another-layout.test.ts` so the wording cannot drift in
 * stealth.
 */
export const ARRANGEMENT_VARIATION_DIRECTIVE =
  "Keep every piece of furniture and decor in the same {aesthetic} style, " +
  "but arrange them differently than the photo: choose a fresh, believable " +
  "layout — reposition the sofa, chairs, tables, and rugs so the room " +
  "reads with a new arrangement that suits the architecture. Keep the walls, " +
  "wall color, flooring, windows, trim, doors, and ceiling exactly as " +
  "photographed; only the arrangement of furniture and decor changes.";

/**
 * Renders the user's nudge into a single short, prompt-safe phrase. Empty
 * or whitespace-only nudges are dropped. Characters that would break the
 * `promptDirectives` schema bound (1–2000 chars) are trimmed, and an
 * ellipsis suffix indicates truncation; the result is embedded as a
 * separate sentence so the model can distinguish it from the
 * architecture-first core.
 */
export function formatTryAnotherLayoutNudge(nudge: string): string | null {
  const trimmed = nudge.trim();
  if (!trimmed) return null;
  const clipped =
    trimmed.length > TRY_ANOTHER_LAYOUT_NUDGE_MAX
      ? `${trimmed.slice(0, TRY_ANOTHER_LAYOUT_NUDGE_MAX).trimEnd()}…`
      : trimmed;
  // Trailing period comes BEFORE the truncation ellipsis (when present),
  // so the ellipsis always lands as the last character of the wrapped
  // sentence — matches the test's `endsWith("…")` pin and the visual
  // expectation that the truncation marker reads as the sentence ending.
  return trimmed.length > TRY_ANOTHER_LAYOUT_NUDGE_MAX
    ? `User nudge for the layout: ${clipped}`
    : `User nudge for the layout: ${clipped}.`;
}

/**
 * Builds the directive string for a "Try another layout" run.
 *
 * The directive is the architecture-first wording from
 * {@link buildHolisticDirectives} (so the constraints on architecture and
 * TV-removal wording carry over verbatim) with an
 * arrangement-variation append and the optional user nudge.
 *
 * Contract: pure string composition; the exact output is pinned by
 * `tests/try-another-layout.test.ts`. The output is the `promptDirectives`
 * field of `POST /api/inpaint` — it must stay within the schema's
 * 1–2000 char bound for any schema-valid aesthetic.
 * Side effects: none (pure).
 */
export function buildTryAnotherLayoutDirectives(input: {
  aesthetic: string;
  nudge?: string | null;
}): string {
  const variationClause = ARRANGEMENT_VARIATION_DIRECTIVE.replace(
    "{aesthetic}",
    input.aesthetic
  );
  const architectureDirective = buildHolisticDirectives({
    aesthetic: input.aesthetic,
    variant: "architecture-first",
  });
  const formattedNudge = formatTryAnotherLayoutNudge(input.nudge ?? "");
  const parts = [
    architectureDirective,
    variationClause,
    ...(formattedNudge ? [formattedNudge] : []),
  ];
  // Final 2000-char cap (issue #190 schema bound). Trim with an ellipsis
  // if the directive would otherwise be rejected by the route schema.
  const joined = parts.join(" ");
  if (joined.length <= 2000) return joined;
  const suffix = "…";
  return `${joined.slice(0, 2000 - suffix.length).trimEnd()}${suffix}`;
}
