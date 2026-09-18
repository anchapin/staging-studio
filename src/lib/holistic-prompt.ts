/**
 * Holistic full-room prompt template (issue #190 spike).
 *
 * The holistic "stage the ENTIRE room" flow replaces the stager's
 * hand-typed directives with a template derived from the project's
 * `stagingAesthetic` — the "Replace all furniture and décor with
 * {aesthetic} alternatives…" phrasing from issue #190/#191. Two wordings
 * are spiked, mirroring the issue's a1/a2 variants:
 *
 * - `thematic` (a1): pure restaging directive.
 * - `architecture-first` (a2): the thematic directive plus explicit
 *   architecture-preservation language and the explicit TV-removal
 *   wording from the issue's TV-frame adherence item ("remove the entire
 *   television including bezel, stand, and cord" family).
 *
 * The route composes the final FLUX prompt exactly as for brush runs —
 * `buildInpaintPrompt(aesthetic, promptDirectives)` — so this module
 * only produces the *directives* string the client sends in that field,
 * plus a holistic-scoped negative prompt.
 *
 * Negative prompt: the single-object `NEGATIVE_PROMPT` suppresses
 * "walls, windows, …, flooring" so generated objects don't smear into
 * architecture. With a full-room mask those regions ARE the regen
 * target, so suppressing them fights the generation. The holistic
 * negative keeps only the artifact terms (bezel/TV-frame/electronics/
 * wires/raw-canvas) and adds architecture-geometry distortion terms.
 *
 * Pure string composition only; side effects: none.
 */

import { FRAMING_CONTEXT, buildInpaintPrompt } from "./prompts";

/** Which wording of the holistic directive template to use. */
export type HolisticPromptVariantId = "thematic" | "architecture-first";

/**
 * Negative prompt for holistic full-room runs: the artifact-suppression
 * subset of the single-object {@link NEGATIVE_PROMPT} (its architecture
 * terms are dropped — under a full-room mask they would suppress the
 * room itself), plus geometry-drift terms protecting window frames and
 * the ceiling/floor lines the decision rule cares about.
 */
export const HOLISTIC_NEGATIVE_PROMPT =
  "bezel, monitor frame, TV border, screen casing, electronics, wires, cables, black plastic trim, raw canvas texture, warped architecture, crooked window frames, crooked ceiling line, crooked floor line";

/**
 * Builds the holistic staging directives for a project aesthetic.
 *
 * Contract: pure string composition; the exact bytes are pinned by
 * `tests/holistic-prompt.test.ts`. The output is the `promptDirectives`
 * field of `POST /api/inpaint` — it must stay within the schema's
 * 1–2000 char bound for any schema-valid aesthetic (1–200 chars), which
 * the tests assert.
 * Side effects: none (pure).
 */
export function buildHolisticDirectives(input: {
  aesthetic: string;
  variant: HolisticPromptVariantId;
}): string {
  const { aesthetic, variant } = input;

  const thematic =
    `Replace all furniture and decor with ${aesthetic} alternatives: sofa, ` +
    "seating, tables, rugs, lighting, artwork, plants, and accessories fully " +
    "restaged to suit the space. Keep the layout believable and the furniture " +
    "scaled to the room's architecture.";

  if (variant === "thematic") {
    return thematic;
  }

  return (
    `${thematic} The walls, windows, trim, doors, ceiling line, and flooring ` +
    "must remain faithful to the original photo — the result must read as the " +
    "same room, only restaged. Remove any television completely, including " +
    "its bezel, stand, wall mount, and cords, and leave the wall behind it clean."
  );
}

/**
 * Builds the exact FLUX.1 Fill prompt a holistic run produces, for
 * review and test pinning. Delegates to {@link buildInpaintPrompt} — the
 * same composition the inpaint route performs — so parity with the
 * existing pipeline holds by construction.
 * Side effects: none (pure).
 */
export function buildHolisticPrompt(
  aesthetic: string,
  variant: HolisticPromptVariantId
): string {
  return buildInpaintPrompt(aesthetic, buildHolisticDirectives({ aesthetic, variant }));
}

/** The framing context shared with the single-object pipeline (re-exported for the spike doc/tests). */
export { FRAMING_CONTEXT };
