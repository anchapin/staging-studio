import { describe, expect, it } from "vitest";

import { inpaintRequestSchema } from "@/lib/ai-route-schemas";
import { HOLISTIC_NEGATIVE_PROMPT } from "@/lib/holistic-prompt";
import {
  HOLISTIC_PRESET_FALLBACK_AESTHETIC,
  HOLISTIC_PRESET_LABEL,
  HOLISTIC_PRESET_PROMPT_VARIANT,
  effectiveHolisticPresetAesthetic,
  resolveHolisticPreset,
} from "@/lib/holistic-preset";

describe("HOLISTIC_PRESET_LABEL", () => {
  it("is the issue #223 furnishings-scoped preset name", () => {
    expect(HOLISTIC_PRESET_LABEL).toBe("Restage furnishings");
  });
});

describe("effectiveHolisticPresetAesthetic", () => {
  it("uses the project aesthetic when set", () => {
    expect(effectiveHolisticPresetAesthetic("Modern Farmhouse")).toEqual({
      aesthetic: "Modern Farmhouse",
      usingFallback: false,
    });
  });

  it("trims whitespace around the project aesthetic", () => {
    expect(effectiveHolisticPresetAesthetic("  Japandi  ")).toEqual({
      aesthetic: "Japandi",
      usingFallback: false,
    });
  });

  it("falls back to the neutral brief for empty, whitespace, null, and undefined", () => {
    const expected = {
      aesthetic: HOLISTIC_PRESET_FALLBACK_AESTHETIC,
      usingFallback: true,
    };
    expect(effectiveHolisticPresetAesthetic("")).toEqual(expected);
    expect(effectiveHolisticPresetAesthetic("   ")).toEqual(expected);
    expect(effectiveHolisticPresetAesthetic(null)).toEqual(expected);
    expect(effectiveHolisticPresetAesthetic(undefined)).toEqual(expected);
  });

  it("keeps the fallback brief within the route's aesthetic bound (1–200 chars)", () => {
    expect(HOLISTIC_PRESET_FALLBACK_AESTHETIC.length).toBeGreaterThanOrEqual(1);
    expect(HOLISTIC_PRESET_FALLBACK_AESTHETIC.length).toBeLessThanOrEqual(200);
  });
});

describe("resolveHolisticPreset", () => {
  it("resolves a furnishings-detection mask so architecture sits outside the regen target (issue #223)", () => {
    const plan = resolveHolisticPreset({ aesthetic: "Modern Farmhouse" });
    expect(plan.maskKind).toBe("furnishings-detection");
    // No geometric strategy ships with the preset anymore — the wall-band
    // mask is what drifted architecture in the field report.
    expect("strategy" in plan).toBe(false);
  });

  it("pins the architecture-first (a2) prompt wording", () => {
    expect(HOLISTIC_PRESET_PROMPT_VARIANT).toBe("architecture-first");
    const plan = resolveHolisticPreset({ aesthetic: "Japandi" });
    expect(plan.promptVariant).toBe("architecture-first");
  });

  it("derives the directives from the project aesthetic", () => {
    const plan = resolveHolisticPreset({ aesthetic: "Modern Farmhouse" });
    expect(plan.directives).toContain(
      "Replace all furniture and decor with Modern Farmhouse alternatives"
    );
    // Architecture-first wording is present:
    expect(plan.directives).toContain("same room, only restaged");
    expect(plan.directives).toContain(
      "including its bezel, stand, wall mount, and cords"
    );
  });

  it("falls back to the neutral brief without dead-ending on an empty aesthetic", () => {
    const plan = resolveHolisticPreset({ aesthetic: "" });
    expect(plan.aesthetic).toBe(HOLISTIC_PRESET_FALLBACK_AESTHETIC);
    expect(plan.usingFallbackAesthetic).toBe(true);
    expect(plan.directives).toContain(
      `Replace all furniture and decor with ${HOLISTIC_PRESET_FALLBACK_AESTHETIC} alternatives`
    );
  });

  it("carries the holistic negative prompt", () => {
    const plan = resolveHolisticPreset({ aesthetic: "Japandi" });
    expect(plan.negativePrompt).toBe(HOLISTIC_NEGATIVE_PROMPT);
  });

  it("produces a request body the inpaint route schema accepts (with and without an aesthetic)", () => {
    for (const aesthetic of ["Modern Farmhouse", "", "   ", undefined]) {
      const plan = resolveHolisticPreset({ aesthetic });
      const parsed = inpaintRequestSchema.safeParse({
        imageUrl: "https://example.supabase.co/storage/v1/object/public/rooms/before.png",
        maskUrl: "data:image/png;base64,AAAA",
        promptDirectives: plan.directives,
        negativePrompt: plan.negativePrompt,
        aesthetic: plan.aesthetic,
        roomId: "room_1",
        variantSlot: 0,
        sourceSlot: null,
      });
      expect(parsed.success).toBe(true);
    }
  });
});
