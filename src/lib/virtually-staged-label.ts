/**
 * "Virtually staged" disclosure helpers (issue #1186).
 *
 * Virtually staged listing photos generally have to be disclosed, and MLS
 * rules on how vary by market. A staged after-image with no label is the
 * kind of thing that can come back on a stager or an agent.
 *
 * Project-scoped: `Project.virtuallyStagedLabelEnabled` (Boolean?,
 * default true on insert; existing rows read as null and treat as enabled
 * — the conservative default for an unlabelled photo is to LABEL it).
 * Per-image: the mark only ever lands on AI after-images, never on the
 * "before" original.
 *
 * Pure logic, pinned by `tests/virtually-staged-label.test.ts`.
 */

/**
 * The literal disclosure text rendered in the corner mark.
 *
 * Kept short enough to fit a corner ribbon at thumbnail size on a
 * dashboard; the wording is the user-facing phrasing — not a wrapper
 * around configuration. A future JSON shape (e.g. custom text per market)
 * would replace the constant, not the function that consumes it.
 */
export const VIRTUALLY_STAGED_LABEL_TEXT = "Virtually Staged" as const;

/**
 * Resolves whether the disclosure mark should render for a project.
 *
 * Treats `null` and `undefined` as enabled — existing rows created
 * before the column existed must default to the safe behavior
 * (label on), and a project's own explicit `false` is the only way
 * to disable.
 */
export function resolveVirtuallyStagedLabelEnabled(
  projectEnabled: boolean | null | undefined
): boolean {
  return projectEnabled !== false;
}

/**
 * Per-image predicate: should the AFTER image in this variant carry the
 * disclosure mark?
 *
 * The label belongs on every AI-staged after-image — i.e. on the variant
 * that the lookbook will show. A room with NO complete variant (no AI
 * staging has completed yet) has no after-image to mark, so the
 * function returns false regardless of the project toggle.
 *
 * The caller decides which variant slot is the selected one; the helper
 * just checks "is this an after image of a complete variant?":
 *   - both before AND after exist on the same variant slot
 *
 * Originals are not "after" images and never receive the badge.
 */
export function isAiStagedAfterImage(
  beforeImageUrl: string | null | undefined,
  afterImageUrl: string | null | undefined
): boolean {
  return Boolean(beforeImageUrl && afterImageUrl);
}

/**
 * The composite decision the lookbook needs to render the badge.
 *
 * Combines the project toggle with the per-image predicate so a render
 * site can call exactly one function. Returns `false` for any of:
 *   - the project toggle is off
 *   - the project toggle is null/undefined AND treated as off (only
 *     possible via an explicit `false`)
 *   - the variant pair is incomplete (no after image to mark)
 *
 * Convenience helper — equivalent to
 * `enabled && isAiStagedAfterImage(before, after)` but kept as a named
 * function so the test suite can pin the AND-combination explicitly.
 */
export function shouldRenderVirtuallyStagedBadge(args: {
  projectEnabled: boolean | null | undefined;
  beforeImageUrl: string | null | undefined;
  afterImageUrl: string | null | undefined;
}): boolean {
  return (
    resolveVirtuallyStagedLabelEnabled(args.projectEnabled) &&
    isAiStagedAfterImage(args.beforeImageUrl, args.afterImageUrl)
  );
}