import { describe, expect, it } from "vitest";

import {
  aiImageUrlSchema,
  aiMaskUrlSchema,
  inpaintRequestSchema,
  segmentConceptSchema,
  visionLabelCropSchema,
  visionLabelOutputSchema,
  VISION_LABEL_MAX_CROPS,
  inpaintQualityGateSchema,
  copyQualityGateSchema,
} from "@/lib/ai-route-schemas";

/**
 * Issue #1061: ai-route-schemas — the schemas consumed by /api/inpaint,
 * /api/segment/furnishings, /api/label-instances, and the
 * AI-quality-gate pre-flight checks.
 *
 * `generateCopyRequestSchema`, `furnishingsSegmentRequestSchema`,
 * `visionLabelRequestSchema`, and `batchRoomTypesRequestSchema` are
 * pinned in tests/generate-copy-request-schema.test.ts and
 * tests/segment-request-schema.test.ts (file names predate the
 * 1:1 convention). This file covers the schemas still missing
 * direct coverage, plus invariants shared across all of them
 * (HTTPS-only imageUrl, data:image-only mask).
 */

const SUPABASE_HOST_URL =
  "https://xxxx.supabase.co/storage/v1/object/public/rooms/before-image.png";
const FAL_HOST_URL = "https://media.fal.ai/files/seed/image.png";

describe("aiImageUrlSchema (issue #1061)", () => {
  it("accepts a https URL on *.supabase.co", () => {
    expect(aiImageUrlSchema.safeParse(SUPABASE_HOST_URL).success).toBe(true);
  });

  it("accepts a https URL on *.fal.ai", () => {
    expect(aiImageUrlSchema.safeParse(FAL_HOST_URL).success).toBe(true);
  });

  it("rejects http (not https)", () => {
    expect(
      aiImageUrlSchema.safeParse("http://xxxx.supabase.co/x.png").success
    ).toBe(false);
  });

  it("rejects an off-allowlist host (e.g. example.com)", () => {
    expect(
      aiImageUrlSchema.safeParse("https://example.com/x.png").success
    ).toBe(false);
  });

  it("rejects a subdomain that is NOT supabase.co or fal.ai (e.g. evil.supabase.co.attacker.com)", () => {
    expect(
      aiImageUrlSchema.safeParse(
        "https://supabase.co.attacker.com/x.png"
      ).success
    ).toBe(false);
  });

  it("rejects a non-URL string", () => {
    expect(aiImageUrlSchema.safeParse("not a url").success).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(aiImageUrlSchema.safeParse("").success).toBe(false);
  });
});

describe("aiMaskUrlSchema (issue #1061)", () => {
  it("accepts a data:image/png URL", () => {
    expect(
      aiMaskUrlSchema.safeParse(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX/AAAZ4gk3AAAAAXRSTlPM0jRW/QAAAApBJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII="
      ).success
    ).toBe(true);
  });

  it("accepts a https URL on the allowlist", () => {
    expect(aiMaskUrlSchema.safeParse(SUPABASE_HOST_URL).success).toBe(true);
  });

  it("rejects a non-allowlist https URL", () => {
    expect(
      aiMaskUrlSchema.safeParse("https://example.com/mask.png").success
    ).toBe(false);
  });

  it("rejects a data URL that is not image/*", () => {
    expect(
      aiMaskUrlSchema.safeParse(
        "data:application/pdf;base64,JVBERi0xLjQKJ"
      ).success
    ).toBe(false);
  });

  it("rejects a string longer than the 5 MB cap", () => {
    const huge = "data:image/png;base64," + "A".repeat(5_000_001);
    expect(aiMaskUrlSchema.safeParse(huge).success).toBe(false);
  });
});

describe("inpaintRequestSchema (issue #1061)", () => {
  const validBody = {
    imageUrl: SUPABASE_HOST_URL,
    maskUrl: "data:image/png;base64,iVBORw0KGgo=",
    promptDirectives: "Replace the worn sofa with a modern linen one.",
    aesthetic: "Warm Organic Modern",
  };

  it("accepts the minimal required body", () => {
    const result = inpaintRequestSchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it("accepts the full AI-guidance field set (#1362b: strength + seed)", () => {
    // Issue #1362b: the schema is now `.strict()` and the legacy
    // fields (`promptStrength`, `maskBlur`, `creativeMode`,
    // `lockSeed`) are dropped. The surviving guidance set is
    // `strength` (DashScope wire name, 0..1) + `seed`.
    const result = inpaintRequestSchema.safeParse({
      ...validBody,
      negativePrompt: "Do not alter the windows.",
      strength: 0.85,
      seed: 42,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty promptDirectives", () => {
    expect(
      inpaintRequestSchema.safeParse({ ...validBody, promptDirectives: "" })
        .success
    ).toBe(false);
  });

  it("rejects a promptDirectives longer than 2000 chars", () => {
    expect(
      inpaintRequestSchema.safeParse({
        ...validBody,
        promptDirectives: "x".repeat(2001),
      }).success
    ).toBe(false);
  });

  it("rejects an aesthetic longer than 200 chars", () => {
    expect(
      inpaintRequestSchema.safeParse({
        ...validBody,
        aesthetic: "x".repeat(201),
      }).success
    ).toBe(false);
  });

  it("rejects strength outside 0.0–1.0 (DashScope wire range, #1362b)", () => {
    // Issue #1362b: the field is `strength` (renamed from
    // `promptStrength`); the range matches DashScope's wire default
    // (0.5) — not fal's 0.1–1.0. Pin both ends.
    expect(
      inpaintRequestSchema.safeParse({ ...validBody, strength: 1.5 }).success
    ).toBe(false);
    expect(
      inpaintRequestSchema.safeParse({ ...validBody, strength: -0.1 })
        .success
    ).toBe(false);
    // Boundary at 0 and 1 must succeed.
    expect(
      inpaintRequestSchema.safeParse({ ...validBody, strength: 0 }).success
    ).toBe(true);
    expect(
      inpaintRequestSchema.safeParse({ ...validBody, strength: 1 }).success
    ).toBe(true);
  });

  it("rejects legacy guidance fields (promptStrength/maskBlur/creativeMode/lockSeed) under .strict() (#1362b)", () => {
    // The schema is `.strict()` (issue #1362b) so a stale client
    // sending the pre-Stage-B field set fails loudly with an
    // "unrecognized key" error instead of silently dropping the
    // user's choice on the floor. Each legacy field gets its own
    // pin so a future operator who un-strictens the schema sees the
    // failure surface explicitly.
    for (const legacyField of [
      "promptStrength",
      "maskBlur",
      "creativeMode",
      "lockSeed",
    ]) {
      const result = inpaintRequestSchema.safeParse({
        ...validBody,
        [legacyField]: legacyField === "creativeMode" || legacyField === "lockSeed" ? false : 1,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        // `.strict()` surfaces an "unrecognized_keys" issue. The
        // exact path may shift between Zod versions, so we assert
        // the error mentions the legacy field name.
        const messages = JSON.stringify(result.error.issues);
        expect(messages).toContain(legacyField);
      }
    }
  });

  it("rejects seed outside 0–999999", () => {
    expect(
      inpaintRequestSchema.safeParse({ ...validBody, seed: 1_000_000 })
        .success
    ).toBe(false);
  });

  it("rejects a non-allowlist imageUrl", () => {
    expect(
      inpaintRequestSchema.safeParse({
        ...validBody,
        imageUrl: "https://example.com/x.png",
      }).success
    ).toBe(false);
  });
});

describe("segmentConceptSchema (issue #1061)", () => {
  it("accepts a single lowercase word", () => {
    expect(segmentConceptSchema.safeParse("sofa").success).toBe(true);
  });

  it("accepts a multi-word phrase with spaces", () => {
    expect(segmentConceptSchema.safeParse("coffee table").success).toBe(true);
  });

  it("accepts a hyphenated phrase", () => {
    expect(segmentConceptSchema.safeParse("side-table").success).toBe(true);
  });

  it("accepts a phrase that is exactly 30 chars", () => {
    expect(segmentConceptSchema.safeParse("a".repeat(30)).success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(segmentConceptSchema.safeParse("").success).toBe(false);
  });

  it("rejects a string longer than 30 chars", () => {
    expect(segmentConceptSchema.safeParse("a".repeat(31)).success).toBe(false);
  });

  it("rejects uppercase letters", () => {
    expect(segmentConceptSchema.safeParse("Sofa").success).toBe(false);
  });

  it("rejects digits", () => {
    expect(segmentConceptSchema.safeParse("sofa1").success).toBe(false);
  });

  it("rejects commas (multi-term lists)", () => {
    expect(segmentConceptSchema.safeParse("sofa, table").success).toBe(false);
  });

  it("rejects sentence punctuation", () => {
    expect(segmentConceptSchema.safeParse("a sofa.").success).toBe(false);
  });
});

describe("visionLabelCropSchema (issue #1061)", () => {
  const validCrop = {
    instanceIndex: 0,
    cropDataUrl: `data:image/jpeg;base64,${"A".repeat(200)}`,
  };

  it("accepts a crop within bounds", () => {
    expect(visionLabelCropSchema.safeParse(validCrop).success).toBe(true);
  });

  it(`accepts instanceIndex at the max boundary (${VISION_LABEL_MAX_CROPS - 1})`, () => {
    expect(
      visionLabelCropSchema.safeParse({
        ...validCrop,
        instanceIndex: VISION_LABEL_MAX_CROPS - 1,
      }).success
    ).toBe(true);
  });

  it(`rejects instanceIndex beyond ${VISION_LABEL_MAX_CROPS - 1}`, () => {
    expect(
      visionLabelCropSchema.safeParse({
        ...validCrop,
        instanceIndex: VISION_LABEL_MAX_CROPS,
      }).success
    ).toBe(false);
  });

  it("rejects a negative instanceIndex", () => {
    expect(
      visionLabelCropSchema.safeParse({ ...validCrop, instanceIndex: -1 })
        .success
    ).toBe(false);
  });

  it("rejects a non-image data URL", () => {
    expect(
      visionLabelCropSchema.safeParse({
        ...validCrop,
        cropDataUrl: "data:text/plain,not an image",
      }).success
    ).toBe(false);
  });

  it("rejects an undersized crop (< 100 chars total)", () => {
    // The min(100) is on the whole cropDataUrl string, including the
    // "data:image/jpeg;base64," prefix (23 chars). A 50-char payload
    // brings the total to 73 — under the 100-char floor.
    expect(
      visionLabelCropSchema.safeParse({
        ...validCrop,
        cropDataUrl: `data:image/jpeg;base64,${"A".repeat(50)}`,
      }).success
    ).toBe(false);
  });

  it("accepts a crop right at the 100-char floor", () => {
    expect(
      visionLabelCropSchema.safeParse({
        ...validCrop,
        cropDataUrl: `data:image/jpeg;base64,${"A".repeat(77)}`,
      }).success
    ).toBe(true);
  });

  it("rejects an oversized crop (> 1.5 MB)", () => {
    expect(
      visionLabelCropSchema.safeParse({
        ...validCrop,
        cropDataUrl: `data:image/jpeg;base64,${"A".repeat(1_500_001)}`,
      }).success
    ).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(
      visionLabelCropSchema.safeParse({ ...validCrop, surprise: "x" }).success
    ).toBe(false);
  });
});

describe("visionLabelOutputSchema (issue #1061)", () => {
  it("accepts a single label entry", () => {
    const result = visionLabelOutputSchema.safeParse({
      labels: [{ instanceIndex: 0, label: "sofa" }],
    });
    expect(result.success).toBe(true);
  });

  it("trims the label string", () => {
    const result = visionLabelOutputSchema.safeParse({
      labels: [{ instanceIndex: 0, label: "  sofa  " }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.labels[0].label).toBe("sofa");
    }
  });

  it("rejects an empty label", () => {
    expect(
      visionLabelOutputSchema.safeParse({
        labels: [{ instanceIndex: 0, label: "" }],
      }).success
    ).toBe(false);
  });

  it("rejects a label longer than 60 chars", () => {
    expect(
      visionLabelOutputSchema.safeParse({
        labels: [{ instanceIndex: 0, label: "x".repeat(61) }],
      }).success
    ).toBe(false);
  });
});

describe("inpaintQualityGateSchema (issue #1061)", () => {
  it("accepts the minimum viable output", () => {
    const result = inpaintQualityGateSchema.safeParse({
      specificity: 2,
      qualityWarnings: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts the full advisory field set", () => {
    expect(
      inpaintQualityGateSchema.safeParse({
        specificity: 3,
        architecture_risk: "Walls will change but mask doesn't cover them.",
        mentions_furnishings: "Mask aligns with the staged sofa.",
        qualityWarnings: ["Walls"],
      }).success
    ).toBe(true);
  });

  it("rejects specificity outside 0–3", () => {
    expect(
      inpaintQualityGateSchema.safeParse({
        specificity: 4,
        qualityWarnings: [],
      }).success
    ).toBe(false);
  });

  it("rejects non-integer specificity", () => {
    expect(
      inpaintQualityGateSchema.safeParse({
        specificity: 2.5,
        qualityWarnings: [],
      }).success
    ).toBe(false);
  });
});

describe("copyQualityGateSchema (issue #1061)", () => {
  it("accepts the minimum viable output", () => {
    const result = copyQualityGateSchema.safeParse({
      specificity: 1,
      qualityWarnings: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts the full advisory field set", () => {
    expect(
      copyQualityGateSchema.safeParse({
        specificity: 2,
        buyer_aligned: "Tone drifts away from young families.",
        checklist_actionable: "Checklist items are vague.",
        aesthetic_consistent: "Contradicts Organic Modern Luxury.",
        qualityWarnings: ["Tone"],
      }).success
    ).toBe(true);
  });

  it("rejects specificity outside 0–3", () => {
    expect(
      copyQualityGateSchema.safeParse({
        specificity: -1,
        qualityWarnings: [],
      }).success
    ).toBe(false);
  });
});