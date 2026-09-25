/**
 * Issue #230: client-side prompt pre-fill naming the replaced concept.
 *
 * The inpaint prompt historically never names the object inside the mask
 * — the model had to infer what the region *is*. This builder produces
 * the editable seed text for prompt fields tied to a known concept:
 * per-object batch rows and the single-object editor's staging
 * directives. The trailing "with " invites the user to complete the
 * sentence with the replacement, and the whole seed stays editable so a
 * wrong CLIP/human label is fixable in one keystroke.
 *
 * Client-side only by design: `buildInpaintPrompt` in `prompts.ts` is
 * byte-pinned (`tests/prompts.test.ts`) and stays untouched. Clearing the
 * seed and typing raw directives needs no mode flag — an empty field is
 * simply today's behavior.
 *
 * Union (thematic) batches intentionally never receive a pre-fill:
 * "Replace the furniture, rug with…" is nonsense across a multi-object
 * union mask — that path owns the holistic vocabulary.
 */

/**
 * Builds the pre-fill prompt for a labeled concept, e.g.
 * `buildPrefill("accent chair")` → `"Replace the accent chair with "`.
 * Returns an empty string for missing/blank labels (positional "Object N"
 * rows and unlabeled selections start empty, matching today's behavior).
 */
export function buildPrefill(concept: string | null | undefined): string {
  const label = concept?.trim();
  if (!label) return "";
  return `Replace the ${label} with `;
}
