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

/** Declutter intensity: 1 = light touch, 5 = full purge. */
export type DeclutterIntensity = 1 | 2 | 3 | 4 | 5;

/** Intensity label for display. */
export const DECLUTTER_INTENSITY_LABELS: Record<DeclutterIntensity, string> = {
  1: "Light",
  2: "Moderate",
  3: "Standard",
  4: "Aggressive",
  5: "Full purge",
};

/**
 * Builds the declutter directive appended to prompts when Global Declutter Mode
 * is active (issue #559).
 *
 * Intensity levels:
 * 1 – Remove only obvious, bulky clutter (papers, boxes).
 * 2 – Remove common clutter items from surfaces.
 * 3 – Clear away clutter from surfaces and floors.
 * 4 – Remove all clutter and non-essential items from every area.
 * 5 – Full purge: leave only core furnishings and architecture.
 */
export function buildDeclutterDirective(intensity: DeclutterIntensity): string {
  switch (intensity) {
    case 1:
      return "Remove only the most obvious clutter — papers, boxes, and similar bulky items — from surfaces.";
    case 2:
      return "Remove common clutter items from surfaces such as papers, bottles, and general debris.";
    case 3:
      return "Clear away clutter from surfaces and floors, leaving only essential furnishings and decor.";
    case 4:
      return "Remove all clutter, debris, and non-essential items from every surface and floor area.";
    case 5:
      return "Full purge: clear the entire space of all clutter, debris, and non-essential items — surfaces, floors, and any visible mess — leaving only core furnishings and architecture intact.";
  }
}

/**
 * Negative prompt for holistic preset runs (issue #223 furnishings
 * scope): the single-object {@link NEGATIVE_PROMPT}'s architecture
 * terms are REINTRODUCED — under a furnishings-union mask the
 * walls/windows/flooring are preserved context outside the mask, so
 * suppressing them keeps the fill from hallucinating new architectural
 * elements inside masked regions instead of fighting the generation —
 * plus the artifact terms and geometry-drift terms protecting window
 * frames and the ceiling/floor lines.
 */
export const HOLISTIC_NEGATIVE_PROMPT =
  "walls, windows, trim, doors, molding, structural columns, flooring, " +
  "bezel, monitor frame, TV border, screen casing, electronics, wires, " +
  "cables, black plastic trim, raw canvas texture, warped architecture, " +
  "crooked window frames, crooked ceiling line, crooked floor line";

/**
 * Builds the holistic staging directives for a project aesthetic.
 *
 * When `declutterMode` is true, a declutter directive is appended using
 * the selected `declutterIntensity` (issue #559).
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
  declutterMode?: boolean;
  declutterIntensity?: DeclutterIntensity;
}): string {
  const { aesthetic, variant, declutterMode = false, declutterIntensity = 3 } = input;

  const thematic =
    `Replace all furniture and decor with ${aesthetic} alternatives: sofa, ` +
    "seating, tables, rugs, lighting, artwork, plants, and accessories fully " +
    "restaged to suit the space. Keep the layout believable and the furniture " +
    "scaled to the room's architecture.";

  if (variant === "thematic") {
    return declutterMode
      ? `${thematic} ${buildDeclutterDirective(declutterIntensity)}`
      : thematic;
  }

  const architectureFirst =
    `Replace all furniture and decor with ${aesthetic} alternatives: sofa, ` +
    "seating, tables, rugs, lighting, artwork, plants, and accessories fully " +
    "restaged to suit the space, and clear away clutter from surfaces. Keep " +
    "the layout believable and the furniture scaled to the room's " +
    "architecture. The walls, wall color, flooring, windows, trim, doors, " +
    "and ceiling must remain exactly as photographed — do not repaint, " +
    "refinish, or alter any architecture; the result must read as the same " +
    "room, only restaged. Remove any television completely, including its " +
    "bezel, stand, wall mount, and cords, and leave the wall behind it clean.";

  return declutterMode
    ? `${architectureFirst} ${buildDeclutterDirective(declutterIntensity)}`
    : architectureFirst;
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
