import { describe, expect, it } from "vitest";

import {
  FAL_FURNISHING_DETECTION_MODEL,
  FURNISHING_DETECTION_MIN_COVERAGE_RATIO,
  FURNISHING_DETECTION_PROMPT,
  buildFurnishingDetectionPayload,
  isFurnishingCoverageAdequate,
  parseFurnishingDetectionResponse,
} from "@/lib/furnishing-detection";

describe("buildFurnishingDetectionPayload", () => {
  const IMAGE = "https://img.supabase.co/storage/v1/object/public/staging-images/before.png";

  it("targets the verified fal-ai/sam-3-1 image endpoint", () => {
    expect(FAL_FURNISHING_DETECTION_MODEL).toBe("fal-ai/sam-3-1/image");
  });

  it("uses the empirically confirmed single-concept prompt", () => {
    // Spike probe (issue #223): "furniture" returns one mask per detected
    // object (9 masks, scores 0.50–0.94 on the probe photo); multi-term
    // comma lists ("furniture, sofa, rug, ...") return ZERO masks.
    expect(FURNISHING_DETECTION_PROMPT).toBe("furniture");
  });

  it("passes the image through unchanged and pins the mask-returning flags (default concept)", () => {
    // Omitted concept ⇒ the verified "furniture" default — the one-click
    // preset path (issue #223) stays byte-equivalent after #227.
    expect(buildFurnishingDetectionPayload({ imageUrl: IMAGE })).toEqual({
      image_url: IMAGE,
      prompt: "furniture",
      apply_mask: false,
      return_multiple_masks: true,
      max_masks: 30,
      include_scores: true,
    });
  });

  it("forwards a caller-supplied concept as the detection prompt (issue #227)", () => {
    expect(buildFurnishingDetectionPayload({ imageUrl: IMAGE, concept: "wall art" })).toEqual({
      image_url: IMAGE,
      prompt: "wall art",
      apply_mask: false,
      return_multiple_masks: true,
      max_masks: 30,
      include_scores: true,
    });
  });

  it("still sends include_scores: true so per-mask scores stay parseable", () => {
    const payload = buildFurnishingDetectionPayload({ imageUrl: IMAGE, concept: "sofa" });
    expect(payload.include_scores).toBe(true);
  });
});

describe("parseFurnishingDetectionResponse", () => {
  const MASK_A = "https://v3b.fal.media/files/b/0aaaea4f/fMvmjI8dt1UM2WGt5_BYn.png";
  const MASK_B = "https://v3b.fal.media/files/b/0aaaea4f/lL7PVN_YOtLEXLxzJgZi3.png";

  it("extracts every mask URL and index-aligned score from the verified SAM 3.1 response shape", () => {
    const response = {
      image: { url: MASK_A, width: 1280, height: 696, content_type: "image/png" },
      masks: [
        { url: MASK_A, width: 1280, height: 696, content_type: "image/png" },
        { url: MASK_B, width: 1280, height: 696, content_type: "image/png" },
      ],
      metadata: [{ index: 5, score: 0.94140625, box: null }],
      scores: [0.94140625, 0.93359375],
      boxes: null,
    };
    expect(parseFurnishingDetectionResponse(response)).toEqual({
      maskUrls: [MASK_A, MASK_B],
      scores: [0.94140625, 0.93359375],
    });
  });

  it("prefers an entry-level score over the top-level array", () => {
    expect(
      parseFurnishingDetectionResponse({
        masks: [{ url: MASK_A, score: 0.5 }],
        scores: [0.99],
      })
    ).toEqual({ maskUrls: [MASK_A], scores: [0.5] });
  });

  it("reports 0 (confidence floor) instead of dropping a kept mask with no resolvable score", () => {
    // No scores array, no entry-level score — the mask still ships so
    // scores.length === maskUrls.length always holds.
    expect(parseFurnishingDetectionResponse({ masks: [{ url: MASK_A }] })).toEqual({
      maskUrls: [MASK_A],
      scores: [0],
    });
    expect(parseFurnishingDetectionResponse({ masks: [{ url: MASK_A }], scores: "junk" })).toEqual(
      {
        maskUrls: [MASK_A],
        scores: [0],
      }
    );
  });

  it("keeps scores index-aligned when mask entries without a URL are skipped", () => {
    // scores[i] is keyed to the mask's ORIGINAL index: skipping the
    // second mask must not shift the third mask onto the second score.
    expect(
      parseFurnishingDetectionResponse({
        masks: [{ url: MASK_A }, { url: "  " }, { url: MASK_B }],
        scores: [0.9, 0.5, 0.7],
      })
    ).toEqual({ maskUrls: [MASK_A, MASK_B], scores: [0.9, 0.7] });
  });

  it("treats an empty masks array as a valid nothing-detected result", () => {
    // The probe returned exactly this shape when the prompt matched nothing.
    expect(parseFurnishingDetectionResponse({ masks: [], scores: [] })).toEqual({
      maskUrls: [],
      scores: [],
    });
  });

  it("skips mask entries without a usable URL", () => {
    expect(
      parseFurnishingDetectionResponse({ masks: [{ url: MASK_A }, { url: "  " }, {}, null] })
    ).toEqual({ maskUrls: [MASK_A], scores: [0] });
  });

  it("returns null for malformed responses", () => {
    expect(parseFurnishingDetectionResponse(null)).toBeNull();
    expect(parseFurnishingDetectionResponse("masks")).toBeNull();
    expect(parseFurnishingDetectionResponse({})).toBeNull();
    expect(parseFurnishingDetectionResponse({ masks: "not-an-array" })).toBeNull();
  });
});

describe("isFurnishingCoverageAdequate", () => {
  it("rejects a union that covers less than the minimum ratio", () => {
    expect(isFurnishingCoverageAdequate(0)).toBe(false);
    expect(isFurnishingCoverageAdequate(FURNISHING_DETECTION_MIN_COVERAGE_RATIO / 2)).toBe(false);
  });

  it("accepts a union at or above the minimum ratio", () => {
    expect(isFurnishingCoverageAdequate(FURNISHING_DETECTION_MIN_COVERAGE_RATIO)).toBe(true);
    // The probe photo's nine-object union covered ~8% of the frame.
    expect(isFurnishingCoverageAdequate(0.08)).toBe(true);
  });

  it("matches the low-coverage precedent used for brush masks", () => {
    // Same 0.5% floor as mask-coverage.ts LOW_COVERAGE_WARNING_THRESHOLD:
    // a furnishings union below it is far more likely a degenerate
    // detection (one tiny object) than a genuinely staged room.
    expect(FURNISHING_DETECTION_MIN_COVERAGE_RATIO).toBe(0.005);
  });
});
