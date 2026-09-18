import { describe, expect, it } from "vitest";

import { inpaintRequestSchema } from "@/lib/ai-route-schemas";
import {
  HOLISTIC_NEGATIVE_PROMPT,
  buildHolisticDirectives,
  buildHolisticPrompt,
} from "@/lib/holistic-prompt";
import { FRAMING_CONTEXT, NEGATIVE_PROMPT, buildInpaintPrompt } from "@/lib/prompts";

describe("buildHolisticDirectives", () => {
  it("pins the exact thematic (a1) directive", () => {
    expect(
      buildHolisticDirectives({ aesthetic: "Modern Farmhouse", variant: "thematic" })
    ).toBe(
      "Replace all furniture and decor with Modern Farmhouse alternatives: sofa, " +
        "seating, tables, rugs, lighting, artwork, plants, and accessories fully " +
        "restaged to suit the space. Keep the layout believable and the furniture " +
        "scaled to the room's architecture."
    );
  });

  it("pins the exact architecture-first (a2) directive with TV-removal wording", () => {
    const directives = buildHolisticDirectives({
      aesthetic: "Modern Farmhouse",
      variant: "architecture-first",
    });

    expect(directives).toBe(
      "Replace all furniture and decor with Modern Farmhouse alternatives: sofa, " +
        "seating, tables, rugs, lighting, artwork, plants, and accessories fully " +
        "restaged to suit the space. Keep the layout believable and the furniture " +
        "scaled to the room's architecture. The walls, windows, trim, doors, " +
        "ceiling line, and flooring must remain faithful to the original photo — " +
        "the result must read as the same room, only restaged. Remove any " +
        "television completely, including its bezel, stand, wall mount, and " +
        "cords, and leave the wall behind it clean."
    );
    expect(directives).toContain("same room, only restaged");
    expect(directives).toContain("including its bezel, stand, wall mount, and cords");
  });

  it("keeps the thematic variant free of architecture-preservation and TV wording", () => {
    const directives = buildHolisticDirectives({
      aesthetic: "Japandi",
      variant: "thematic",
    });
    expect(directives).not.toContain("television");
    expect(directives).not.toContain("must remain faithful");
  });

  it("stays within the promptDirectives schema bound for a max-length aesthetic", () => {
    const maxAesthetic = "x".repeat(200); // inpaintRequestSchema: aesthetic ≤ 200
    for (const variant of ["thematic", "architecture-first"] as const) {
      const directives = buildHolisticDirectives({ aesthetic: maxAesthetic, variant });
      expect(directives.length).toBeLessThanOrEqual(2000);
      expect(directives.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("buildHolisticPrompt", () => {
  it("composes exactly what the inpaint route produces from the directives", () => {
    const aesthetic = "Coastal";
    const variant = "architecture-first" as const;
    const directives = buildHolisticDirectives({ aesthetic, variant });

    expect(buildHolisticPrompt(aesthetic, variant)).toBe(
      buildInpaintPrompt(aesthetic, directives)
    );
    expect(buildHolisticPrompt(aesthetic, variant)).toBe(
      `${aesthetic} style. ${directives} ${FRAMING_CONTEXT}`
    );
    // #182 framing language survives in the holistic path.
    expect(buildHolisticPrompt(aesthetic, variant)).toContain("own frame and mounting");
  });
});

describe("HOLISTIC_NEGATIVE_PROMPT", () => {
  it("pins the exact holistic negative prompt", () => {
    expect(HOLISTIC_NEGATIVE_PROMPT).toBe(
      "bezel, monitor frame, TV border, screen casing, electronics, wires, " +
        "cables, black plastic trim, raw canvas texture, warped architecture, " +
        "crooked window frames, crooked ceiling line, crooked floor line"
    );
  });

  it("drops the single-object architecture-suppression terms that fight a full-room regen", () => {
    expect(HOLISTIC_NEGATIVE_PROMPT).not.toMatch(/\bwalls\b/);
    expect(HOLISTIC_NEGATIVE_PROMPT).not.toMatch(/\bwindows\b/);
    expect(HOLISTIC_NEGATIVE_PROMPT).not.toMatch(/\bflooring\b/);
    expect(HOLISTIC_NEGATIVE_PROMPT).not.toMatch(/\bdoors\b/);
  });

  it("keeps the bezel/TV-frame artifact terms and differs from the single-object default", () => {
    expect(HOLISTIC_NEGATIVE_PROMPT).toContain("bezel");
    expect(HOLISTIC_NEGATIVE_PROMPT).toContain("TV border");
    expect(HOLISTIC_NEGATIVE_PROMPT).toContain("raw canvas texture");
    expect(HOLISTIC_NEGATIVE_PROMPT).not.toBe(NEGATIVE_PROMPT);
  });
});

describe("end-to-end schema compatibility", () => {
  const baseRequest = {
    imageUrl: "https://room.supabase.co/storage/v1/object/public/before.jpg",
    maskUrl: "data:image/png;base64,AAAA",
  };

  it("parses a full holistic request (directives + negative prompt) against inpaintRequestSchema", () => {
    const parsed = inpaintRequestSchema.safeParse({
      ...baseRequest,
      promptDirectives: buildHolisticDirectives({
        aesthetic: "Modern Farmhouse",
        variant: "architecture-first",
      }),
      aesthetic: "Modern Farmhouse",
      negativePrompt: HOLISTIC_NEGATIVE_PROMPT,
    });
    expect(parsed.success).toBe(true);
  });

  it("still parses without negativePrompt (brush path unchanged)", () => {
    const parsed = inpaintRequestSchema.safeParse({
      ...baseRequest,
      promptDirectives: "a painting",
      aesthetic: "Modern Farmhouse",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty or oversized negativePrompt override", () => {
    const empty = inpaintRequestSchema.safeParse({
      ...baseRequest,
      promptDirectives: "a painting",
      aesthetic: "Modern Farmhouse",
      negativePrompt: "",
    });
    expect(empty.success).toBe(false);

    const oversized = inpaintRequestSchema.safeParse({
      ...baseRequest,
      promptDirectives: "a painting",
      aesthetic: "Modern Farmhouse",
      negativePrompt: "x".repeat(2001),
    });
    expect(oversized.success).toBe(false);
  });
});
