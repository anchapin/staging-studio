export interface CopyPromptInput {
  roomName: string;
  aesthetic: string;
  targetBuyer: string;
  rawDirectives: string;
}

export const NEGATIVE_PROMPT =
  "walls, windows, trim, doors, molding, structural columns, flooring, bezel, monitor frame, TV border, screen casing, electronics, wires, cables, black plastic trim, raw canvas texture";

// Framing/physicality language appended to every inpaint prompt: without
// it, FLUX renders replacements (e.g. "a painting") as raw canvas texture
// pasted onto the wall — no frame, no depth, no wall blending. The
// holistic full-room prompt (issue #190, `holistic-prompt.ts`) reuses the
// same sentence so both paths share the framing work from #182.
export const FRAMING_CONTEXT =
  "Presented as a finished object with its own frame and mounting, " +
  "integrated natural shadows and depth, clean surrounding wall.";

// FLUX.1 Fill [dev] with LoRAs — the live fal endpoint (the old
// "fal-ai/flux/1/fill" route was removed from fal's queue; submit
// succeeded but execution 404'd with "Path /1/fill not found").
// Requires @fal-ai/serverless-client >= 0.15 — older 0.6.x mangles
// multi-segment ids into "https://fal-ai/<model>.<host>/..." (ENOTFOUND).
export const FAL_FLUX_FILL_MODEL = "fal-ai/flux-lora-fill";

export interface FalFillPayloadInput {
  imageUrl: string;
  maskUrl: string;
  prompt: string;
  /**
   * Overrides the negative prompt (issue #190: the holistic full-room
   * path sends `HOLISTIC_NEGATIVE_PROMPT`, whose architecture terms are
   * re-scoped). Omitted ⇒ the single-object default {@link NEGATIVE_PROMPT}.
   */
  negativePrompt?: string;
}

// Type alias (not interface) so the payload stays assignable to the
// `Record<string, unknown>` input type of `fal.queue.submit`.
export type FalFillPayload = {
  image_url: string;
  mask_url: string;
  prompt: string;
  negative_prompt: string;
  guidance: number;
  num_inference_steps: number;
}

/**
 * Builds the gpt-4o-mini copywriting prompt sent to `generateObject` in
 * `api/generate-copy`.
 *
 * Contract: pure string composition; the exact bytes are pinned by
 * `tests/prompts.test.ts` — output quality of the paid model is sensitive
 * to these strings, so edits here should be deliberate and re-pinned.
 * Side effects: none (pure).
 */
export function buildCopyPrompt(input: CopyPromptInput): string {
  const { roomName, aesthetic, targetBuyer, rawDirectives } = input;

  return `You are a professional home staging copywriter for a staging company.

Generate structured copywriting for a room with the following details:
- Room: ${roomName}
- Design Aesthetic: ${aesthetic}
- Target Buyer: ${targetBuyer}
- Staging Directives: ${rawDirectives}

Based on the room details and staging directives, generate:
1. **observedChallenge**: Describe the key staging challenge or opportunity observed in this room
2. **recommendation**: A compelling, actionable staging recommendation that aligns with the aesthetic and buyer profile
3. **buyerPsychology**: Insight into what this buyer profile is looking for and how staging addresses their emotional drivers
4. **checklist**: A prioritized action checklist with categories:
   - DIY/Declutter: Simple fixes sellers can do themselves
   - Rental Inventory: Items that can be rented/procured
   - Minor Repair: Small repairs and touch-ups needed

Be specific, professional, and focused on maximizing the room's appeal to ${targetBuyer}.`;
}

/**
 * Builds the FLUX.1 Fill prompt from the room's aesthetic and staging
 * directives, appending {@link FRAMING_CONTEXT} so masked replacements
 * render as physical, framed objects integrated into the wall instead of
 * raw texture pasted onto the masked area.
 *
 * Contract: returns `${aesthetic} style. ${directives}` followed by the
 * fixed framing sentence, with any trailing whitespace removed — in
 * particular, empty directives yield
 * `"${aesthetic} style. ${FRAMING_CONTEXT}"` with no trailing space.
 * Side effects: none (pure).
 */
export function buildInpaintPrompt(
  aesthetic: string,
  directives: string
): string {
  const base = `${aesthetic} style. ${directives}`.replace(/\s+$/, "");
  return `${base} ${FRAMING_CONTEXT}`;
}

/**
 * Builds the `input` payload for the fal.ai FLUX.1 Fill queue submit
 * (`fal.queue.submit("fal-ai/flux-fill", { input })`) in `api/inpaint`.
 *
 * Contract: `guidance` is pinned to 7.5 and `num_inference_steps` to 28;
 * `negative_prompt` is {@link NEGATIVE_PROMPT} unless the caller passes
 * `negativePrompt` (the holistic full-room path does); image/mask/prompt
 * fields pass through unchanged. The exact shape is pinned by
 * `tests/prompts.test.ts` — changing it alters paid generation output.
 * Side effects: none (pure).
 */
export function buildFalFillPayload(
  input: FalFillPayloadInput
): FalFillPayload {
  return {
    image_url: input.imageUrl,
    mask_url: input.maskUrl,
    prompt: input.prompt,
    negative_prompt: input.negativePrompt ?? NEGATIVE_PROMPT,
    guidance: 7.5,
    num_inference_steps: 28,
  };
}
