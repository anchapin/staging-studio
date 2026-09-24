/**
 * Post-staging display-state resolution (issue #168).
 *
 * Once a variant completes, the room card and the focused room view show
 * the staged "after" image directly instead of a draggable before/after
 * slider: the before photo already sits in `RoomCanvas` directly above, so
 * the slider was redundant friction for inspecting a fresh result.
 *
 * The helpers here resolve WHICH variant's after image to display (the
 * selected one, falling back to A then B — the same fallback the slider
 * used), the visible label ("Variant B — staged"), and the image's alt
 * text ("{roomName} staged — Variant B"), so the grid cards and the
 * focused view render identically.
 *
 * Pure logic so the fallback order, labels, and alt text are pinned 1:1 by
 * `tests/staged-result.test.ts`.
 */

/** One variant slot's imagery, as stored on a room (`…ImageUrl` / `…ImageUrl2`). */
export interface StagedVariantPair {
  before: string | null;
  after: string | null;
}

/**
 * A variant is complete — i.e. stageable/showable as a staged result —
 * only when BOTH its before and after images exist. An after image without
 * a before never occurs in practice (inpainting runs from a before photo),
 * but the pair gate keeps the invariant explicit.
 */
export function isCompleteVariantPair(pair: StagedVariantPair): boolean {
  return Boolean(pair.before && pair.after);
}

/** Visible label for a variant slot: "Variant A — staged" / "Variant B — staged". */
export function stagedVariantLabel(index: number): string {
  return `Variant ${index === 1 ? "B" : "A"} — staged`;
}

/**
 * Alt text for the staged after image: "{roomName} staged — Variant A/B",
 * degrading to "Staged — Variant A/B" when no room name is available.
 */
export function stagedResultAlt(
  roomName: string | null | undefined,
  index: number
): string {
  const variant = index === 1 ? "B" : "A";
  const prefix = roomName?.trim() ? `${roomName.trim()} staged` : "Staged";
  return `${prefix} — Variant ${variant}`;
}

/** Everything a view needs to render one room's staged "after" image. */
export interface StagedResultDisplay {
  /** Which variant slot's after image is displayed (0 = A, 1 = B). */
  variantIndex: number;
  /** The staged after image URL (guaranteed non-null when this exists). */
  afterImageUrl: string;
  /** Visible label, e.g. "Variant B — staged". */
  label: string;
  /** Image alt text, e.g. "Living room staged — Variant B". */
  alt: string;
}

/**
 * Resolves the staged result to display for a room. Follows the room's
 * `selectedVariantIndex` (0 when unset); when that variant is incomplete it
 * falls back to variant A, then variant B — so a fresh result is always
 * visible as soon as any complete variant exists. Returns null when the
 * room has no complete variant at all (nothing staged to show yet).
 */
export function resolveStagedResultDisplay(
  roomName: string | null | undefined,
  pairs: readonly [StagedVariantPair, StagedVariantPair],
  selectedIndex: number
): StagedResultDisplay | null {
  const requested = selectedIndex === 1 ? 1 : 0;
  const displayIndex = isCompleteVariantPair(pairs[requested])
    ? requested
    : isCompleteVariantPair(pairs[0])
      ? 0
      : 1;
  const pair = pairs[displayIndex];
  if (!isCompleteVariantPair(pair)) return null;
  return {
    variantIndex: displayIndex,
    afterImageUrl: pair.after as string,
    label: stagedVariantLabel(displayIndex),
    alt: stagedResultAlt(roomName, displayIndex),
  };
}
