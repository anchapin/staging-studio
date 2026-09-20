/**
 * Concept chips + client-side concept validation (issue #228).
 *
 * The staging editor's Select Objects tool prompts SAM 3.1 with a single
 * concept (one billed call per (image, concept) — see
 * `api/segment/furnishings`, issue #227) and returns every detected
 * instance at once; clicks only hit-test client-side. This module owns
 * the editor's concept UX surface:
 *
 * - `CONCEPT_CHIPS`: the one-tap taxonomy. The catch-all "furniture"
 *   probe (issue #223 spike) is FIRST — it is also the editor-open
 *   auto-fire default, so a user who never touches the chips still gets
 *   a useful full-furnishings detection. Specific concepts follow.
 * - `isValidConceptName`: the CLIENT mirror of the server's
 *   `segmentConceptSchema` (issue #227) — trim, 1–30 characters after
 *   trimming, lowercase letters/spaces/hyphens only (`^[a-z -]+$`).
 *   Commas and sentence punctuation are rejected because the spike probe
 *   showed SAM 3.1 returns ZERO masks for multi-term comma lists and one
 *   weak mask for full sentences; a malformed concept can only waste a
 *   quota-billed call. Free text is validated HERE, before any request
 *   is built — a member of `CONCEPT_CHIPS` passes by construction.
 *
 * Also home to the `selection_logged` console-event builder: every
 * instance toggle emits one (training-corpus seed for the find-and-
 * replace initiative; W3 depends on this exact shape).
 *
 * Side effects: none (pure builders + validation only).
 */

/** One-tap concept taxonomy. `DEFAULT_CONCEPT` must stay FIRST. */
export const CONCEPT_CHIPS = [
  "furniture",
  "sofa",
  "chair",
  "table",
  "rug",
  "bed",
  "lamp",
  "artwork",
  "plant",
  "curtains",
  "nightstand",
  "mirror",
  "desk",
  "wardrobe",
  "bookshelf",
] as const;

export type ConceptChip = (typeof CONCEPT_CHIPS)[number];

/**
 * The catch-all detection concept: editor-open auto-fire and the
 * negative-copy suggestion both point here. Mirrors the route's
 * omitted-concept default (`FURNISHING_DETECTION_PROMPT`).
 */
export const DEFAULT_CONCEPT: ConceptChip = "furniture";

/**
 * Client mirror of the server's `segmentConceptSchema` (issue #227):
 * trim, 1–30 characters after trimming, `^[a-z -]+$` (lowercase letters,
 * spaces, hyphens; no commas, digits, or sentence punctuation; no
 * word-count cap). Must be updated in lockstep with the schema — the
 * chip members pass by construction.
 * Side effects: none (pure validation).
 */
export function isValidConceptName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 30) return false;
  return /^[a-z -]+$/.test(trimmed);
}

/**
 * Forgives the common free-text slip — capitals — before validation
 * (issue #249): trims and lowercases. Run the result through
 * {@link isValidConceptName}; normalization can't rescue commas, digits,
 * or over-length phrases, and validation (the server-schema mirror) stays
 * strict on purpose.
 * Side effects: none (pure).
 */
export function normalizeConceptInput(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Negative-result copy for a concept detection that legitimately found
 * nothing (an empty `maskDataUrls` is a valid response, not an error).
 * The brush is named FIRST (issue #249) — when detection comes up empty
 * it is the reliable fallback. The literal-suggestion variant only makes
 * sense for non-default concepts; the catch-all falls back to pointing
 * at the other chips.
 * Side effects: none (pure).
 */
export function buildConceptEmptyMessage(concept: string): string {
  const name = isValidConceptName(concept) ? concept.trim() : DEFAULT_CONCEPT;
  return name === DEFAULT_CONCEPT
    ? `no ${name} found — paint the area with the brush, or try another concept`
    : `no ${name} found — paint the area with the brush, or try '${DEFAULT_CONCEPT}'`;
}

/** Stable console prefix so operators can filter concept-tool events. */
export const CONCEPT_EVENT_LOG_PREFIX = "[concept-tool]";

/** A successful instance toggle, logged for the training corpus (W3). */
export interface SelectionLoggedEvent {
  event: "selection_logged";
  roomId: string;
  /** The active detection concept at toggle time. */
  concept: string;
  /** Position of the toggled instance in the score-ranked response. */
  instanceIndex: number;
  /** Provider score for that instance, or null when unavailable. */
  score: number | null;
  /** Present only once batch-panel labels exist (W3 shape allowance). */
  editedLabel?: string;
}

/**
 * Builds the `selection_logged` event for one instance toggle (both the
 * add and the remove direction — the corpus wants every interaction).
 * Side effects: none (pure).
 */
export function buildSelectionLoggedEvent(input: {
  roomId: string;
  concept: string;
  instanceIndex: number;
  score?: number | null;
  editedLabel?: string;
}): SelectionLoggedEvent {
  const event: SelectionLoggedEvent = {
    event: "selection_logged",
    roomId: input.roomId,
    concept: input.concept,
    instanceIndex: input.instanceIndex,
    score: typeof input.score === "number" && Number.isFinite(input.score) ? input.score : null,
  };
  if (input.editedLabel !== undefined) event.editedLabel = input.editedLabel;
  return event;
}
