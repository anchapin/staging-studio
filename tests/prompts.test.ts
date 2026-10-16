import { describe, expect, it } from "vitest";

import {
  FAL_FLUX_FILL_MODEL,
  NEGATIVE_PROMPT,
  buildCopyPrompt,
  buildFalFillPayload,
  buildInpaintPrompt,
  buildListingCopyPrompt,
  buildReplicateFillPayload,
} from "@/lib/prompts";

const REPRESENTATIVE_ROOM = {
  roomName: "Primary Bedroom",
  aesthetic: "Modern Farmhouse",
  targetBuyer: "Young families",
  rawDirectives: "King bed centered on the accent wall; add two nightstands.",
};

describe("buildCopyPrompt", () => {
  it("composes the exact copywriting prompt for a representative room", () => {
    expect(buildCopyPrompt(REPRESENTATIVE_ROOM)).toBe(
      `You are a professional home staging copywriter for a staging company.

Generate structured copywriting for a room with the following details:
- Room: Primary Bedroom
- Design Aesthetic: Modern Farmhouse
- Target Buyer: Young families
- Staging Directives: King bed centered on the accent wall; add two nightstands.

Based on the room details and staging directives, generate:
1. **observedChallenge**: Describe the key staging challenge or opportunity observed in this room
2. **recommendation**: A compelling, actionable staging recommendation that aligns with the aesthetic and buyer profile
3. **buyerPsychology**: Insight into what this buyer profile is looking for and how staging addresses their emotional drivers
4. **checklist**: A prioritized action checklist with categories:
   - DIY/Declutter: Simple fixes sellers can do themselves
   - Rental Inventory: Items that can be rented/procured
   - Minor Repair: Small repairs and touch-ups needed

Be specific, professional, and focused on maximizing the room's appeal to Young families.`
    );
  });

  it("handles empty optional room fields without altering structure", () => {
    const prompt = buildCopyPrompt({
      roomName: "",
      aesthetic: "",
      targetBuyer: "",
      rawDirectives: "",
    });

    expect(prompt).toContain("- Room: \n");
    expect(prompt).toContain("- Design Aesthetic: \n");
    expect(prompt).toContain("- Target Buyer: \n");
    expect(prompt).toContain("- Staging Directives: \n");
    expect(prompt.endsWith("appeal to .")).toBe(true);
  });
});

describe("buildListingCopyPrompt (issue #1343)", () => {
  it("composes the exact listing-copy prompt for a representative room", () => {
    expect(
      buildListingCopyPrompt({
        roomName: "Primary Bedroom",
        aesthetic: "Modern Farmhouse",
        targetBuyer: "Young families",
        rawDirectives: "King bed centered on the accent wall; add two nightstands.",
        priorHeadline: "Calm bedroom with restored crown molding",
      })
    ).toBe(
      `You are a professional home staging copywriter for a staging company.

Write the listing copy for a single room shown in the lookbook next to its before/after photos.
- Room: Primary Bedroom
- Design Aesthetic: Modern Farmhouse
- Target Buyer: Young families
- Staging Directives: King bed centered on the accent wall; add two nightstands.
The previous headline on this room was: "Calm bedroom with restored crown molding".
If the staging directives still apply, prefer to keep the same framing; if the directives have changed, write a fresh headline from the new directives.

Return exactly two fields, both written for the lookbook reader (a real-estate shopper scanning photos, not a stager reading notes):
1. **headline** — a one-line, concrete headline (5–12 words, up to 200 characters) that names a specific feature or mood of the staged room. Never generic ("Beautiful room!", "Stunning space!"). Avoid punctuation like a marketing slogan; this is descriptive.
2. **body** — a one- or two-sentence paragraph (up to 600 characters) that brings the room to life for the target buyer. Mention a concrete staging choice the buyer would notice (light, palette, layout, focal point), not "Attention to detail".

Do not include bullets, JSON, or any field other than the two above. Keep the prose specific to Young families; avoid filler words that could describe any room.`
    );
  });

  it("omits the prior-headline block when priorHeadline is not provided", () => {
    const prompt = buildListingCopyPrompt({
      roomName: "Kitchen",
      aesthetic: "Coastal",
      targetBuyer: "First-time homebuyers",
      rawDirectives: "Bring in a runner, swap to brushed-brass pulls.",
    });
    expect(prompt).not.toContain("previous headline");
    expect(prompt).not.toContain('"Calm bedroom');
  });

  it("merges global and room directives the same way buildCopyPrompt does (#562)", () => {
    const roomScoped = buildListingCopyPrompt({
      roomName: "Kitchen",
      aesthetic: "Coastal",
      targetBuyer: "First-time homebuyers",
      rawDirectives: "Bring in a runner.",
      globalDirectives: "Lean into natural materials.",
    });
    expect(roomScoped).toContain(
      "- Staging Directives: Lean into natural materials.\n\nRoom-specific: Bring in a runner."
    );
    // When only global directives exist, the merge still surfaces them
    // (the listing-copy rewrite is still brief-able from project-level
    // staging intent alone).
    const globalOnly = buildListingCopyPrompt({
      roomName: "Kitchen",
      aesthetic: "Coastal",
      targetBuyer: "First-time homebuyers",
      rawDirectives: "",
      globalDirectives: "Lean into natural materials.",
    });
    expect(globalOnly).toContain("- Staging Directives: Lean into natural materials.");
  });

  it("includes the headline/body cap copy so the model picks fields that fit listingCopySchema", () => {
    const prompt = buildListingCopyPrompt({
      roomName: "Kitchen",
      aesthetic: "Coastal",
      targetBuyer: "First-time homebuyers",
      rawDirectives: "Light palette, brass hardware.",
    });
    // The caps here mirror the schema-side ones (200/600). Drift
    // between prompt and schema would let a borderline-long output
    // blow past `saveListingCopy`'s validation.
    expect(prompt).toContain("up to 200 characters");
    expect(prompt).toContain("up to 600 characters");
  });
});

describe("buildInpaintPrompt", () => {
  const FRAMING =
    "Presented as a finished object with its own frame and mounting, integrated natural shadows and depth, clean surrounding wall.";

  it("joins aesthetic and directives with the style preamble and appends framing context", () => {
    expect(
      buildInpaintPrompt("Modern Farmhouse", "King bed centered on the accent wall.")
    ).toBe(`Modern Farmhouse style. King bed centered on the accent wall. ${FRAMING}`);
  });

  it("produces no trailing whitespace when directives are empty", () => {
    const prompt = buildInpaintPrompt("Coastal", "");

    expect(prompt).toBe(`Coastal style. ${FRAMING}`);
    expect(prompt).not.toMatch(/\s$/);
  });

  it("trims trailing whitespace even when directives are whitespace-only", () => {
    const prompt = buildInpaintPrompt("Coastal", "   \n\t ");

    expect(prompt).toBe(`Coastal style. ${FRAMING}`);
    expect(prompt).not.toMatch(/\s$/);
  });

  it("preserves directives verbatim when they end in normal characters", () => {
    expect(
      buildInpaintPrompt("Japandi", "Oak console, linen sofa, no window treatments.")
    ).toBe(`Japandi style. Oak console, linen sofa, no window treatments. ${FRAMING}`);
  });

  it("appends framing language so replacements render as framed objects, not raw texture", () => {
    const prompt = buildInpaintPrompt("Modern Farmhouse", "a painting");

    expect(prompt).toContain("own frame and mounting");
    expect(prompt).toContain("natural shadows");
    expect(prompt).toContain("clean surrounding wall");
  });
});

describe("NEGATIVE_PROMPT", () => {
  it("exports the exact FLUX.1 Fill negative prompt with bezel/electronics suppression terms", () => {
    expect(NEGATIVE_PROMPT).toBe(
      "walls, windows, trim, doors, molding, structural columns, flooring, bezel, monitor frame, TV border, screen casing, electronics, wires, cables, black plastic trim, raw canvas texture"
    );
  });
});

describe("buildFalFillPayload", () => {
  it("pins the exact fal queue input: guidance 7.5, 28 steps, negative prompt", () => {
    expect(
      buildFalFillPayload({
        imageUrl: "https://example.supabase.co/storage/v1/object/public/before.png",
        maskUrl: "data:image/png;base64,abc123",
        prompt: "Modern Farmhouse style. King bed centered on the accent wall.",
      })
    ).toEqual({
      image_url: "https://example.supabase.co/storage/v1/object/public/before.png",
      mask_url: "data:image/png;base64,abc123",
      prompt: "Modern Farmhouse style. King bed centered on the accent wall.",
      negative_prompt: NEGATIVE_PROMPT,
      guidance: 7.5,
      num_inference_steps: 28,
    });
  });

  it("exposes the exact flux-fill model id used by the queue submit", () => {
    expect(FAL_FLUX_FILL_MODEL).toBe("fal-ai/flux-lora-fill");
  });

  it("carries framing language and extended negative terms end-to-end", () => {
    const prompt = buildInpaintPrompt("Modern Farmhouse", "a painting");
    const payload = buildFalFillPayload({
      imageUrl: "https://example.supabase.co/a.png",
      maskUrl: "https://example.supabase.co/b.png",
      prompt,
    });

    expect(payload.prompt).toContain("own frame and mounting");
    expect(payload.negative_prompt).toContain("bezel");
    expect(payload.negative_prompt).toContain("raw canvas texture");
  });

  it("carries exactly the six documented keys — no payload drift", () => {
    const payload = buildFalFillPayload({
      imageUrl: "https://example.supabase.co/a.png",
      maskUrl: "https://example.supabase.co/b.png",
      prompt: "x style. y",
    });

    expect(Object.keys(payload).sort()).toEqual([
      "guidance",
      "image_url",
      "mask_url",
      "negative_prompt",
      "num_inference_steps",
      "prompt",
    ]);
  });
});

describe("buildReplicateFillPayload", () => {
  it("pins the Replicate wire shape: image/mask/prompt, prompt_strength 1.0, 28 steps, png output, integer safety_tolerance", () => {
    // The #1200 probe caught `safety_tolerance: "2"` (string literal)
    // being sent as a JSON string; Replicate rejected it with
    // "Invalid type. Expected: integer, given: string". This test
    // pins both the value and the type so a future regression is
    // caught without a real network call.
    const payload = buildReplicateFillPayload({
      imageUrl: "https://example.supabase.co/storage/v1/object/public/before.png",
      maskUrl: "data:image/png;base64,abc123",
      prompt: "Mid-century modern armchair in walnut and cream boucle",
    });
    expect(payload).toEqual({
      image: "https://example.supabase.co/storage/v1/object/public/before.png",
      mask: "data:image/png;base64,abc123",
      prompt: "Mid-century modern armchair in walnut and cream boucle",
      prompt_strength: 1.0,
      num_inference_steps: 28,
      output_format: "png",
      safety_tolerance: 2,
    });
    // Belt and braces: also assert the JSON-serialized type so a
    // future regression to a string literal is caught even if the
    // structural equality above somehow still passes.
    const serialized = JSON.parse(JSON.stringify(payload));
    expect(typeof serialized.safety_tolerance).toBe("number");
    expect(serialized.safety_tolerance).toBe(2);
  });

  it("scales promptStrength 0.1–1.0 up to Replicate's 1–10 range", () => {
    const payload = buildReplicateFillPayload({
      imageUrl: "i",
      maskUrl: "m",
      prompt: "p",
      promptStrength: 0.7,
    });
    expect(payload.prompt_strength).toBe(7);
  });

  it("drops prompt_strength to 0.5 in creative mode (lower guidance = more variation)", () => {
    const payload = buildReplicateFillPayload({
      imageUrl: "i",
      maskUrl: "m",
      prompt: "p",
      creativeMode: true,
    });
    expect(payload.prompt_strength).toBe(0.5);
  });

  it("carries exactly the seven documented keys — no payload drift", () => {
    const payload = buildReplicateFillPayload({
      imageUrl: "https://example.supabase.co/a.png",
      maskUrl: "https://example.supabase.co/b.png",
      prompt: "x style. y",
    });
    expect(Object.keys(payload).sort()).toEqual([
      "image",
      "mask",
      "num_inference_steps",
      "output_format",
      "prompt",
      "prompt_strength",
      "safety_tolerance",
    ]);
  });
});
