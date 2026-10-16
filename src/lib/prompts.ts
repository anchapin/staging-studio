import {
  sanitizePromptValue,
  sanitizePromptArray,
} from "./sanitize-prompt";

export interface BuyerDemographicsInput {
  buyerType: string;
  designPreferences: string[];
  budgetMin: number;
  budgetMax: number;
  mustHaveFeatures: string[];
  sellTimeline: string;
}

export interface CopyPromptInput {
  roomName: string;
  aesthetic: string;
  targetBuyer: string;
  /** Room-specific directives (override or supplement global directives). */
  rawDirectives: string;
  /** Issue #562: Global project-level directives applied to every room. */
  globalDirectives?: string;
  buyerDemographics?: BuyerDemographicsInput;
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

// Issue #788: extracted from room-type-detection.ts so it can be reviewed and
// tested in isolation, matching the pattern used for other vision prompt modules.
export const ROOM_TYPE_SYSTEM_PROMPT = `You are an expert interior design assistant. Given a room photo, identify the room type from this list:
- Primary Bedroom
- Secondary Bedroom
- Living Room
- Dining Room
- Kitchen
- Bathroom
- Home Office
- Garage
- Outdoor/Patio
- Other

Respond with ONLY the room type name. If uncertain, respond with the most likely option.`;

// FLUX.1 Fill [dev] with LoRAs — the live fal endpoint (the old
// "fal-ai/flux/1/fill" route was removed from fal's queue; submit
// succeeded but execution 404'd with "Path /1/fill not found").
// Requires @fal-ai/client >= 1.x — older @fal-ai/serverless-client
// 0.6.x mangles multi-segment ids into "https://fal-ai/<model>.<host>/..."
// (ENOTFOUND).
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
  /**
   * Issue #558: AI guidance controls.
   * `promptStrength` (0.1–1.0): how closely AI follows the text prompt.
   * Defaults to 0.8.
   */
  promptStrength?: number;
  /**
   * Issue #558: feather edges of the mask for softer transitions (0–20).
   * Defaults to 5.
   */
  maskBlur?: number;
  /**
   * Issue #558: reproducible seed for iteration (0–999999). Omit for random.
   */
  seed?: number;
  /**
   * Issue #558: when true, use a lower guidance value for higher variation.
   */
  creativeMode?: boolean;
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
  /** Issue #558: feather edges of the mask. */
  mask_blur?: number;
  /** Issue #558: reproducible seed. */
  seed?: number;
}

/**
 * Issue #562: Merges global project directives with room-specific directives.
 * Room directives take precedence; global directives fill in gaps.
 * Empty global directives → returns room directives verbatim.
 * Both empty → returns "Per room requirements".
 */
export function mergeDirectives(
  globalDirectives: string | null | undefined,
  roomDirectives: string | null | undefined
): string {
  const global = (globalDirectives ?? "").trim();
  const room = (roomDirectives ?? "").trim();

  if (!global && !room) return "";
  if (!global) return room;
  if (!room) return global;
  // Both present: room builds on global (global first, room supplements)
  return `${global}\n\nRoom-specific: ${room}`;
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
  const {
    roomName: rawRoomName,
    aesthetic: rawAesthetic,
    targetBuyer: rawTargetBuyer,
    rawDirectives: rawRawDirectives,
    globalDirectives: rawGlobalDirectives,
    buyerDemographics: rawBuyerDemographics,
  } = input;

  const roomName = sanitizePromptValue(rawRoomName);
  const aesthetic = sanitizePromptValue(rawAesthetic);
  const targetBuyer = sanitizePromptValue(rawTargetBuyer);
  const rawDirectives = sanitizePromptValue(rawRawDirectives);
  const globalDirectives = sanitizePromptValue(rawGlobalDirectives);
  const buyerDemographics = rawBuyerDemographics
    ? {
        ...rawBuyerDemographics,
        designPreferences: sanitizePromptArray(rawBuyerDemographics.designPreferences),
        mustHaveFeatures: sanitizePromptArray(rawBuyerDemographics.mustHaveFeatures),
      }
    : undefined;

  // Issue #562: merge global + room directives
  const mergedDirectives = mergeDirectives(globalDirectives, rawDirectives);

  let demographicsBlock = "";
  if (buyerDemographics) {
    const {
      buyerType,
      designPreferences,
      budgetMin,
      budgetMax,
      mustHaveFeatures,
      sellTimeline,
    } = buyerDemographics;

    const timelineLabel: Record<string, string> = {
      under_30_days: "Under 30 days (urgent)",
      "30_60_days": "30-60 days",
      "60_90_days": "60-90 days",
      over_90_days: "Over 90 days",
    };

    const buyerTypeLabel: Record<string, string> = {
      young_professional: "Young Professional",
      growing_family: "Growing Family",
      downsizing_retiree: "Downsizing Retiree",
      investor: "Investor",
      luxury_buyer: "Luxury Buyer",
      first_time_homebuyer: "First-Time Homebuyer",
      serial_renovator: "Serial Renovator",
    };

    const featureLabel: Record<string, string> = {
      home_office: "Home Office",
      open_plan: "Open Plan Living",
      outdoor_space: "Outdoor Space",
      gourmet_kitchen: "Gourmet Kitchen",
      master_suite: "Master Suite",
      smart_home: "Smart Home Features",
      energy_efficient: "Energy Efficiency",
      multigenerational: "Multigenerational Living",
      home_gym: "Home Gym",
      pet_friendly: "Pet-Friendly Features",
    };

    const prefsLabel: Record<string, string> = {
      contemporary: "Contemporary",
      traditional: "Traditional",
      minimalist: "Minimalist",
      maximalist: "Maximalist",
      coastal: "Coastal",
      industrial: "Industrial",
      midcentury_modern: "Mid-Century Modern",
      scandinavian: "Scandinavian",
      bohemian: "Bohemian",
      transitional: "Transitional",
    };

    demographicsBlock = `
- Buyer Type: ${buyerTypeLabel[buyerType] ?? buyerType}
- Design Preferences: ${designPreferences.map((p) => prefsLabel[p] ?? p).join(", ")}
- Budget Range: $${budgetMin}k - $${budgetMax}k
- Must-Have Features: ${mustHaveFeatures.map((f) => featureLabel[f] ?? f).join(", ")}
- Sell Timeline: ${timelineLabel[sellTimeline] ?? sellTimeline}`;
  }

  return `You are a professional home staging copywriter for a staging company.

Generate structured copywriting for a room with the following details:
- Room: ${roomName}
- Design Aesthetic: ${aesthetic}
- Target Buyer: ${targetBuyer}${demographicsBlock}
- Staging Directives: ${mergedDirectives}

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

export interface ListingCopyPromptInput {
  roomName: string;
  aesthetic: string;
  targetBuyer: string;
  /** Room-specific staging directives (override or supplement global directives). */
  rawDirectives: string;
  /** Issue #562: project-wide directives applied to every room. */
  globalDirectives?: string;
  /**
   * Optional lookbook headline already on the room — feeds the model
   * so a re-rewrite doesn't drift to a different angle. The legacy
   * {@link buildCopyPrompt} carries `buyerDemographics` because the
   * staging-copy fields (observed challenge, recommendation, …) read
   * better with the buyer detail in view; the listing-copy fields
   * stay short enough that a 200-char headline is more useful as a
   * tone anchor than another 200 tokens of demographics.
   */
  priorHeadline?: string;
}

/**
 * Builds the gpt-4o-mini prompt for the CopyPanel's "Rewrite from
 * directions" CTA (issue #1343) sent to `generateObject` in
 * `api/v1/listing-copy`.
 *
 * Output shape is exactly two fields (`headline` + `body`); both are
 * sized to fit the `<CopyPanel>`'s `<input>` (200) and `<textarea
 * maxLength={600}>` contracts (cf. `listingCopySchema` in
 * `src/lib/room-copy-edit-schema.ts`). The prompt deliberately asks
 * for two short fields and forbids bullets/JSON-in-prose so the
 * structured-output schema stays easy to validate server-side — a
 * stuck call that produces a 2000-character essay would blow past
 * the body cap and the `saveListingCopy` write would reject the
 * payload with a 422.
 *
 * Contract: pure string composition; the exact bytes are pinned by
 * `tests/prompts.test.ts` — output quality of the paid model is
 * sensitive to these strings, so edits here should be deliberate and
 * re-pinned. Side effects: none (pure).
 */
export function buildListingCopyPrompt(input: ListingCopyPromptInput): string {
  const {
    roomName: rawRoomName,
    aesthetic: rawAesthetic,
    targetBuyer: rawTargetBuyer,
    rawDirectives: rawRawDirectives,
    globalDirectives: rawGlobalDirectives,
    priorHeadline: rawPriorHeadline,
  } = input;

  const roomName = sanitizePromptValue(rawRoomName);
  const aesthetic = sanitizePromptValue(rawAesthetic);
  const targetBuyer = sanitizePromptValue(rawTargetBuyer);
  const rawDirectives = sanitizePromptValue(rawRawDirectives);
  const globalDirectives = sanitizePromptValue(rawGlobalDirectives);
  const priorHeadline = rawPriorHeadline ? sanitizePromptValue(rawPriorHeadline) : "";

  // Issue #562: merge global + room directives, same rule as
  // `buildCopyPrompt` so the listing copy stays consistent with the
  // staging copy when both are generated from the same project.
  const mergedDirectives = mergeDirectives(globalDirectives, rawDirectives);

  const priorBlock = priorHeadline
    ? `\nThe previous headline on this room was: "${priorHeadline}".\nIf the staging directives still apply, prefer to keep the same framing; if the directives have changed, write a fresh headline from the new directives.`
    : "";

  return `You are a professional home staging copywriter for a staging company.

Write the listing copy for a single room shown in the lookbook next to its before/after photos.
- Room: ${roomName}
- Design Aesthetic: ${aesthetic}
- Target Buyer: ${targetBuyer}
- Staging Directives: ${mergedDirectives}${priorBlock}

Return exactly two fields, both written for the lookbook reader (a real-estate shopper scanning photos, not a stager reading notes):
1. **headline** — a one-line, concrete headline (5–12 words, up to ${LISTING_COPY_HEADLINE_MAX} characters) that names a specific feature or mood of the staged room. Never generic ("Beautiful room!", "Stunning space!"). Avoid punctuation like a marketing slogan; this is descriptive.
2. **body** — a one- or two-sentence paragraph (up to ${LISTING_COPY_BODY_MAX} characters) that brings the room to life for the target buyer. Mention a concrete staging choice the buyer would notice (light, palette, layout, focal point), not "Attention to detail".

Do not include bullets, JSON, or any field other than the two above. Keep the prose specific to ${targetBuyer}; avoid filler words that could describe any room.`;
}

// Issue #1343 — the CopyPanel's `<input maxLength=…>` and `<textarea
// maxLength=…>` are pinned to 200 and 600. The persisted schema
// (`listingCopySchema` in `src/lib/room-copy-edit-schema.ts`) and the
// rewrite-output schema (`listingCopyOutputSchema` in
// `src/lib/ai-route-schemas.ts`) mirror these caps; the prompt asks
// for output UNDER these caps so a borderline long headline still
// fits through the body cap. Kept as locals (not imported) so
// `prompts.ts` stays a leaf module — `ai-route-schemas.ts` already
// imports from it via the buildCopyPrompt callers, and pulling
// prompts in the other direction would risk a circular dependency.
const LISTING_COPY_HEADLINE_MAX = 200;
const LISTING_COPY_BODY_MAX = 600;

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
  const safeAesthetic = sanitizePromptValue(aesthetic);
  const safeDirectives = sanitizePromptValue(directives);
  const base = `${safeAesthetic} style. ${safeDirectives}`.replace(/\s+$/, "");
  return `${base} ${FRAMING_CONTEXT}`;
}

/**
 * Builds the `input` payload for the fal.ai FLUX.1 Fill queue submit
 * (`fal.queue.submit("fal-ai/flux-fill", { input })`) in `api/inpaint`.
 *
 * Contract: `guidance` defaults to 7.5 and `num_inference_steps` to 28;
 * `negative_prompt` is {@link NEGATIVE_PROMPT} unless the caller passes
 * `negativePrompt` (the holistic full-room path does); image/mask/prompt
 * fields pass through unchanged. When `promptStrength` is provided (issue #558),
 * it overrides the default guidance (scaled to fal.ai's 1–10 range). When
 * `creativeMode` is true, a lower guidance (~4.0) enables higher variation.
 * `mask_blur` feathers mask edges for softer transitions. `seed` enables
 * reproducible results when `lockSeed` is set. The exact shape is pinned by
 * `tests/prompts.test.ts` — changing it alters paid generation output.
 * Side effects: none (pure).
 */
export function buildFalFillPayload(
  input: FalFillPayloadInput
): FalFillPayload {
  // Issue #558: compute effective guidance. Creative mode uses a lower
  // guidance for more variation; otherwise use promptStrength (scaled from
  // the 0.1–1.0 UI range to fal.ai's 1–10 scale), falling back to 7.5.
  let guidance = 7.5;
  if (input.creativeMode) {
    guidance = 4.0;
  } else if (input.promptStrength !== undefined) {
    guidance = input.promptStrength * 10;
  }

  const payload: FalFillPayload = {
    image_url: input.imageUrl,
    mask_url: input.maskUrl,
    prompt: input.prompt,
    negative_prompt: input.negativePrompt ?? NEGATIVE_PROMPT,
    guidance,
    num_inference_steps: 28,
  };

  // Issue #558: optional AI guidance params
  if (input.maskBlur !== undefined) {
    payload.mask_blur = input.maskBlur;
  }
  if (input.seed !== undefined) {
    payload.seed = input.seed;
  }

  return payload;
}

// ─── Alibaba (DashScope multimodal-conversation) payload ───────────────

/**
 * Alibaba Cloud's DashScope multimodal-conversation endpoint
 * (`/v1/services/aigc/multimodal-generation/generation`) takes a much
 * smaller payload than fal or Replicate: `image_url` + `prompt` are
 * the only call-shape fields used today. Provider-specific knobs
 * (`guidance`, `mask_blur`, `num_inference_steps`, `negative_prompt`,
 * `seed`) are not exposed — DashScope accepts a single `seed` at the
 * top level of `parameters`, and the alibaba-adapter hardcodes the
 * other values. Documenting the dropped fields here so a future
 * operator who tries to wire one through is pointed at the right place.
 */
export interface AlibabaFillPayloadInput {
  imageUrl: string;
  /** Alibaba is instruction-mode; mask_url is ignored by the model. */
  maskUrl: string;
  prompt: string;
  /** Held for API parity; the adapter does not forward `negativePrompt`. */
  negativePrompt?: string;
  /** Held for API parity; the adapter uses a fixed guidance scale. */
  promptStrength?: number;
  /** Held for API parity; the adapter does not forward `maskBlur`. */
  maskBlur?: number;
  /** Held for API parity; the adapter hardcodes its own seed value. */
  seed?: number;
  /** Held for API parity; the adapter hardcodes its own sampling choice. */
  creativeMode?: boolean;
}

/**
 * The DashScope multimodal-conversation payload, provider-neutral.
 * Only the fields the model actually consumes are populated; the
 * "held for parity" fields above are intentionally NOT included so
 * the wire shape is the minimum the API accepts.
 */
export type AlibabaFillPayload = {
  image_url: string;
  prompt: string;
};

export function buildAlibabaFillPayload(
  input: AlibabaFillPayloadInput
): AlibabaFillPayload {
  return {
    image_url: input.imageUrl,
    prompt: input.prompt,
  };
}

// ─── Replicate payload ─────────────────────────────────────────────────────

/**
 * `black-forest-labs/flux-fill-pro` (Replicate) expects snake_case
 * keys too but a different schema than fal. `prompt_strength` and
 * `num_inference_steps` are the closest analogs. We map the same
 * UI inputs to the Replicate field names; the negative prompt uses
 * the same default since the architecture-no-touch invariant is
 * provider-agnostic.
 */
export interface ReplicateFillPayloadInput {
  imageUrl: string;
  maskUrl: string;
  prompt: string;
  negativePrompt?: string;
  promptStrength?: number;
  maskBlur?: number;
  seed?: number;
  creativeMode?: boolean;
}

export type ReplicateFillPayload = {
  image: string;
  mask: string;
  prompt: string;
  // Replicate uses a single `prompt_strength` parameter on this model.
  prompt_strength: number;
  num_inference_steps: number;
  // Replicate's `output_format` is a post-process control; we keep
  // it pinned so the result is deterministic.
  output_format: "png";
  // Replicate's API requires `safety_tolerance` as an INTEGER (the
  // #1200 probe caught a string-typed-as-string regression here:
  // Replicate returned "Invalid type. Expected: integer, given: string").
  // Range is 0..6 per the model card; 2 is the v1 default.
  safety_tolerance: number;
} & Record<string, unknown>;

export function buildReplicateFillPayload(
  input: ReplicateFillPayloadInput
): ReplicateFillPayload {
  // Issue #558: same guidance logic as the fal payload — creative
  // mode is a lower prompt_strength, otherwise scale from 0.1–1.0
  // to Replicate's 1–10 range.
  let promptStrength = 1.0;
  if (input.creativeMode) {
    promptStrength = 0.5;
  } else if (input.promptStrength !== undefined) {
    promptStrength = input.promptStrength * 10;
  }

  const payload: ReplicateFillPayload = {
    image: input.imageUrl,
    mask: input.maskUrl,
    prompt: input.prompt,
    prompt_strength: promptStrength,
    num_inference_steps: 28,
    output_format: "png",
    safety_tolerance: 2,
  };
  return payload;
}

/**
 * Picks the right provider-specific payload builder based on the
 * active provider. Call sites that have already translated their
 * UI input into the logical shape can hand it to this and get the
 * correct wire format back, without importing provider-specific
 * modules. Side effects: reads `process.env.INFERENCE_PROVIDER`.
 *
 * Provider dispatch is done by reading `INFERENCE_PROVIDER`
 * directly (rather than calling `resolveProvider()` from
 * `@/lib/inference`) to keep `prompts.ts` independent of the
 * abstraction module — that avoids a circular import (the
 * abstraction's clients may import the payload builders for their
 * submit shapes, and prompts is the natural home for those).
 */
export function buildInpaintPayloadForActiveProvider(
  input:
    | FalFillPayloadInput
    | ReplicateFillPayloadInput
    | AlibabaFillPayloadInput
): Record<string, unknown> {
  const provider = process.env.INFERENCE_PROVIDER?.trim().toLowerCase();
  if (provider === "replicate") {
    return buildReplicateFillPayload(input as ReplicateFillPayloadInput) as unknown as Record<string, unknown>;
  }
  if (provider === "fal") {
    return buildFalFillPayload(input as FalFillPayloadInput) as unknown as Record<string, unknown>;
  }
  // alibaba (default), or any unknown value
  return buildAlibabaFillPayload(input as AlibabaFillPayloadInput) as unknown as Record<string, unknown>;
}
