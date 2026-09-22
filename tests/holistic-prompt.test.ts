import { describe, expect, it } from "vitest";

import { inpaintRequestSchema } from "@/lib/ai-route-schemas";
import {
  HOLISTIC_NEGATIVE_PROMPT,
  buildDeclutterDirective,
  buildHolisticDirectives,
  buildHolisticPrompt,
  DECLUTTER_INTENSITY_LABELS,
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
        "restaged to suit the space, and clear away clutter from surfaces. Keep " +
        "the layout believable and the furniture scaled to the room's " +
        "architecture. The walls, wall color, flooring, windows, trim, doors, " +
        "and ceiling must remain exactly as photographed — do not repaint, " +
        "refinish, or alter any architecture; the result must read as the same " +
        "room, only restaged. Remove any television completely, including its " +
        "bezel, stand, wall mount, and cords, and leave the wall behind it clean."
    );
    expect(directives).toContain("same room, only restaged");
    expect(directives).toContain("including its bezel, stand, wall mount, and cords");
  });

  it("scopes the architecture-first variant to furnishings (issue #223)", () => {
    const directives = buildHolisticDirectives({
      aesthetic: "Japandi",
      variant: "architecture-first",
    });
    expect(directives).toContain("clear away clutter from surfaces");
    expect(directives).toContain("exactly as photographed");
    expect(directives).toContain("do not repaint, refinish, or alter any architecture");
  });

  it("keeps the thematic variant free of architecture-preservation and TV wording", () => {
    const directives = buildHolisticDirectives({
      aesthetic: "Japandi",
      variant: "thematic",
    });
    expect(directives).not.toContain("television");
    expect(directives).not.toContain("exactly as photographed");
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
  it("pins the exact furnishings-scoped holistic negative prompt", () => {
    expect(HOLISTIC_NEGATIVE_PROMPT).toBe(
      "walls, windows, trim, doors, molding, structural columns, flooring, " +
        "bezel, monitor frame, TV border, screen casing, electronics, wires, " +
        "cables, black plastic trim, raw canvas texture, warped architecture, " +
        "crooked window frames, crooked ceiling line, crooked floor line"
    );
  });

  it("reintroduces the single-object architecture terms now that architecture sits outside the mask (issue #223)", () => {
    // Under a furnishings-union mask, walls/windows/flooring are preserved
    // context, not regen targets — suppressing them keeps the fill from
    // hallucinating new architectural elements inside masked regions.
    expect(HOLISTIC_NEGATIVE_PROMPT).toMatch(/\bwalls\b/);
    expect(HOLISTIC_NEGATIVE_PROMPT).toMatch(/\bwindows\b/);
    expect(HOLISTIC_NEGATIVE_PROMPT).toMatch(/\bflooring\b/);
    expect(HOLISTIC_NEGATIVE_PROMPT).toMatch(/\bdoors\b/);
  });

  it("keeps the bezel/TV-frame artifact and geometry-drift terms", () => {
    expect(HOLISTIC_NEGATIVE_PROMPT).toContain("bezel");
    expect(HOLISTIC_NEGATIVE_PROMPT).toContain("TV border");
    expect(HOLISTIC_NEGATIVE_PROMPT).toContain("raw canvas texture");
    expect(HOLISTIC_NEGATIVE_PROMPT).toContain("warped architecture");
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

describe("buildDeclutterDirective (issue #559)", () => {
  it("returns unique text for each intensity level", () => {
    const results = ([1, 2, 3, 4, 5] as const).map((i) => buildDeclutterDirective(i));
    const unique = new Set(results);
    expect(unique.size).toBe(5);
  });

  it("intensity 1 mentions only obvious, bulky clutter", () => {
    const d = buildDeclutterDirective(1);
    expect(d).toContain("obvious");
    expect(d).toContain("bulky");
  });

  it("intensity 5 uses 'full purge' language", () => {
    const d = buildDeclutterDirective(5);
    expect(d.toLowerCase()).toContain("full purge");
    expect(d.toLowerCase()).toContain("core furnishings");
  });

  it("DECLUTTER_INTENSITY_LABELS has all 5 levels", () => {
    expect(DECLUTTER_INTENSITY_LABELS).toHaveProperty("1", "Light");
    expect(DECLUTTER_INTENSITY_LABELS).toHaveProperty("5", "Full purge");
  });
});

describe("buildHolisticDirectives with declutterMode (issue #559)", () => {
  it("appends declutter directive when declutterMode is true (thematic variant)", () => {
    const result = buildHolisticDirectives({
      aesthetic: "Modern Farmhouse",
      variant: "thematic",
      declutterMode: true,
      declutterIntensity: 3,
    });
    expect(result).toContain("Clear away clutter from surfaces and floors");
  });

  it("does NOT append declutter directive when declutterMode is false", () => {
    const without = buildHolisticDirectives({
      aesthetic: "Modern Farmhouse",
      variant: "thematic",
      declutterMode: false,
    });
    const withDefault = buildHolisticDirectives({
      aesthetic: "Modern Farmhouse",
      variant: "thematic",
    });
    expect(without).toBe(withDefault);
    expect(without).not.toContain("bulky clutter");
  });

  it("appends declutter directive for architecture-first variant", () => {
    const result = buildHolisticDirectives({
      aesthetic: "Japandi",
      variant: "architecture-first",
      declutterMode: true,
      declutterIntensity: 4,
    });
    expect(result).toContain("all clutter");
    expect(result).toContain("non-essential items");
  });

  it("stays within the promptDirectives schema bound when declutter is enabled", () => {
    const maxAesthetic = "x".repeat(200);
    for (const variant of ["thematic", "architecture-first"] as const) {
      const result = buildHolisticDirectives({
        aesthetic: maxAesthetic,
        variant,
        declutterMode: true,
        declutterIntensity: 5,
      });
      expect(result.length).toBeLessThanOrEqual(2000);
      expect(result.length).toBeGreaterThanOrEqual(1);
    }
  });
});
