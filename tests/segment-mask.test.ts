import { describe, expect, it } from "vitest";

import {
  FAL_SAM_MODEL,
  buildFalSegmentPayload,
  parseFalSegmentResponse,
} from "@/lib/segment-mask";

describe("buildFalSegmentPayload", () => {
  it("wraps the click as a single foreground point prompt in natural pixels", () => {
    const payload = buildFalSegmentPayload({
      imageUrl: "https://example.supabase.co/storage/v1/object/public/rooms/before.png",
      point: { x: 512.5, y: 384 },
    });
    expect(payload.image_url).toBe(
      "https://example.supabase.co/storage/v1/object/public/rooms/before.png"
    );
    expect(payload.point_prompt).toEqual([[512.5, 384]]);
    expect(payload.point_label).toEqual([1]);
  });

  it("pins the mask-image options so output matches the editor's white-on-black semantics", () => {
    const payload = buildFalSegmentPayload({
      imageUrl: "https://example.supabase.co/before.png",
      point: { x: 0, y: 0 },
    });
    expect(payload.black_white).toBe(true);
    expect(payload.retina).toBe(true);
    expect(payload.better_quality).toBe(true);
  });

  it("stays assignable to the Record<string, unknown> shape fal.subscribe accepts", () => {
    const payload: Record<string, unknown> = buildFalSegmentPayload({
      imageUrl: "https://example.supabase.co/before.png",
      point: { x: 1, y: 2 },
    });
    expect(payload["point_prompt"]).toEqual([[1, 2]]);
  });
});

describe("parseFalSegmentResponse", () => {
  it("extracts the mask image URL from the documented response shape", () => {
    const result = parseFalSegmentResponse({
      image: {
        url: "https://fal.media/files/mask.png",
        width: 1024,
        height: 768,
        content_type: "image/png",
      },
    });
    expect(result).toEqual({ maskUrl: "https://fal.media/files/mask.png" });
  });

  it("returns null for missing, blank, or non-string image URLs", () => {
    expect(parseFalSegmentResponse({ image: {} })).toBeNull();
    expect(parseFalSegmentResponse({ image: { url: "" } })).toBeNull();
    expect(parseFalSegmentResponse({ image: { url: "   " } })).toBeNull();
    expect(parseFalSegmentResponse({ image: { url: 42 } })).toBeNull();
  });

  it("returns null for malformed responses", () => {
    expect(parseFalSegmentResponse(null)).toBeNull();
    expect(parseFalSegmentResponse(undefined)).toBeNull();
    expect(parseFalSegmentResponse("mask.png")).toBeNull();
    expect(parseFalSegmentResponse({})).toBeNull();
    expect(parseFalSegmentResponse({ image: "https://fal.media/files/mask.png" })).toBeNull();
  });
});

describe("FAL_SAM_MODEL", () => {
  it("points at fal.ai's SAM endpoint", () => {
    expect(FAL_SAM_MODEL).toBe("fal-ai/sam");
  });
});
