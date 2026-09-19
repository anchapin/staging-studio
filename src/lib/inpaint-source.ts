/**
 * Progressive inpainting source resolution (issue #170).
 *
 * An inpaint run starts from one of two kinds of source images:
 * - `{ kind: "original" }` — the room's original before photo (the only
 *   option before issue #170; result lands via {@link pickVariantSlot}).
 * - `{ kind: "variant", slot }` — a completed variant's staged result; the
 *   new result overwrites that same variant's after slot in place, so the
 *   lookbook's selected variant never changes without explicit user action.
 *
 * Everything here is pure so the slot semantics can be pinned 1:1 by
 * `tests/inpaint-source.test.ts`.
 */

/** Which of the room's two image variants a value refers to. */
export type VariantSlot = 0 | 1;

/** The image an inpaint run edits from (issue #170 source selector). */
export type InpaintSource = { kind: "original" } | { kind: "variant"; slot: VariantSlot };

/** The room image fields the source resolution needs (structural subset of `Room`). */
export interface InpaintSourceRoom {
  beforeImageUrl: string | null;
  afterImageUrl: string | null;
  afterImageUrl2: string | null;
  selectedVariantIndex: number | null;
}

/** The persisted `InpaintRequest` fields needed to reconstruct a run's source. */
export interface InpaintRequestSourceRow {
  sourceSlot: number | null;
}

/** Partial `Room` patch sent to `PATCH /api/projects/:id/rooms/:roomId` after a run. */
export interface InpaintResultPatch {
  afterImageUrl?: string;
  afterImageUrl2?: string;
  beforeImageUrl2?: string;
  selectedVariantIndex?: number;
}

/**
 * Which variant slot a fresh (original-source) inpaint result lands in: the
 * first empty "after" slot, or — when both are full — the slot NOT currently
 * selected, so the lookbook selection stays stable. Moved verbatim from
 * `project-detail-view.tsx` (issue #170); behavior is preserved and now
 * pinned by tests.
 */
export function pickVariantSlot(room: InpaintSourceRoom): VariantSlot {
  if (!room.afterImageUrl) return 0;
  if (!room.afterImageUrl2) return 1;
  return room.selectedVariantIndex === 1 ? 0 : 1;
}

/**
 * Source options for the editor's selector, in display order: the original
 * photo first, then each variant that has a completed staged result.
 * The original is always available — the editor only renders when a
 * before photo exists.
 */
export function listInpaintSources(room: InpaintSourceRoom): InpaintSource[] {
  const sources: InpaintSource[] = [{ kind: "original" }];
  if (room.afterImageUrl) sources.push({ kind: "variant", slot: 0 });
  if (room.afterImageUrl2) sources.push({ kind: "variant", slot: 1 });
  return sources;
}

/** Human label for a source option in the editor's selector. */
export function inpaintSourceLabel(source: InpaintSource): string {
  if (source.kind === "original") return "Original photo";
  return source.slot === 0 ? "Variant A (staged)" : "Variant B (staged)";
}

/** Structural equality for source values (used for radio-group checked state). */
export function inpaintSourcesEqual(a: InpaintSource, b: InpaintSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "variant" && b.kind === "variant") return a.slot === b.slot;
  return true;
}

/**
 * Whether the editor's Entire-room staging tab is available (issue #252
 * D5/AC-L4): visible iff the displayed base image is the ORIGINAL source
 * photo — a full restage never runs on top of a staged result, so the tab
 * hides over any variant and reappears when the base switches back. Pure
 * function of the source alone, pinned by `tests/inpaint-source.test.ts`.
 */
export function entireRoomTabVisible(source: InpaintSource): boolean {
  return source.kind === "original";
}

/**
 * The image URL an inpaint run edits from, or `null` when the source's
 * image is missing (callers fall back to the before photo; the selector
 * only ever offers existing variants, so this is defensive).
 */
export function resolveInpaintSourceUrl(
  room: InpaintSourceRoom,
  source: InpaintSource
): string | null {
  if (source.kind === "original") return room.beforeImageUrl;
  return source.slot === 0 ? room.afterImageUrl : room.afterImageUrl2;
}

/**
 * The "after" slot a run's result lands in: in-place for variant sources
 * (issue #170), {@link pickVariantSlot} for the original photo.
 */
export function resolveInpaintTargetSlot(
  room: InpaintSourceRoom,
  source: InpaintSource
): VariantSlot {
  if (source.kind === "variant") return source.slot;
  return pickVariantSlot(room);
}

/**
 * Builds the room PATCH body that persists a completed run's result.
 *
 * Contract: fresh runs (original source) keep the pre-#170 behavior —
 * slot 0 sets `afterImageUrl` + selects variant A; slot 1 mirrors the
 * before photo into `beforeImageUrl2`, sets `afterImageUrl2`, and selects
 * variant B. Variant-source runs overwrite the variant's after slot in
 * place and never touch `selectedVariantIndex`, so the lookbook selection
 * cannot change without explicit user action.
 *
 * Side effects: none — pure function.
 */
export function buildInpaintResultPatch(
  room: InpaintSourceRoom,
  resultUrl: string,
  source: InpaintSource
): InpaintResultPatch {
  if (source.kind === "variant") {
    return source.slot === 0
      ? { afterImageUrl: resultUrl }
      : { afterImageUrl2: resultUrl };
  }

  const slot = pickVariantSlot(room);
  if (slot === 0) {
    return { afterImageUrl: resultUrl, selectedVariantIndex: 0 };
  }
  // A before photo always exists for a slot-1 fresh run (the editor only
  // renders when it does); the guard keeps the patch schema-valid (null is
  // not an acceptable image URL) should the invariant ever break.
  return room.beforeImageUrl
    ? {
        beforeImageUrl2: room.beforeImageUrl,
        afterImageUrl2: resultUrl,
        selectedVariantIndex: 1,
      }
    : { afterImageUrl2: resultUrl, selectedVariantIndex: 1 };
}

/**
 * Self-heals a stored source selection against current room data (issue
 * #223): a variant source whose staged result no longer exists (session
 * state out of sync with the room — persistence failure, variant
 * cleared, data refreshed underneath the session) falls back to the
 * original photo instead of submitting a dead `sourceSlot` that the
 * inpaint route rejects with a 400. Sources whose image still exists
 * pass through unchanged.
 *
 * Side effects: none — pure function.
 */
export function healInpaintSource(
  room: InpaintSourceRoom,
  source: InpaintSource
): InpaintSource {
  if (source.kind === "variant" && !resolveInpaintSourceUrl(room, source)) {
    return { kind: "original" };
  }
  return source;
}

/**
 * Reconstructs the source of a persisted run from its stored `sourceSlot`
 * (`null` or any unexpected value ⇒ original-photo run — the pre-#170
 * semantics every legacy row carries).
 */
export function inpaintSourceFromRequestRow(
  row: InpaintRequestSourceRow
): InpaintSource {
  if (row.sourceSlot === 0 || row.sourceSlot === 1) {
    return { kind: "variant", slot: row.sourceSlot };
  }
  return { kind: "original" };
}
