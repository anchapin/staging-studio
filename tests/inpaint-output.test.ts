import { describe, expect, it } from "vitest";

import { extractInpaintImageUrls, firstInpaintImageUrl } from "@/lib/inpaint-output";

describe("extractInpaintImageUrls (#1199)", () => {
  it("reads fal's { images: [{ url }] } shape, keeping extra fields out of the way", () => {
    const output = {
      images: [
        { url: "https://fal.media/a.png", width: 1024, height: 768, content_type: "image/png" },
        { url: "https://fal.media/b.png" },
      ],
      seed: 42,
      has_nsfw_concepts: [false],
    };
    expect(extractInpaintImageUrls(output)).toEqual([
      "https://fal.media/a.png",
      "https://fal.media/b.png",
    ]);
  });

  it("reads Replicate's top-level [url1, url2] array", () => {
    expect(
      extractInpaintImageUrls([
        "https://replicate.delivery/x/out-0.webp",
        "https://replicate.delivery/x/out-1.webp",
      ])
    ).toEqual([
      "https://replicate.delivery/x/out-0.webp",
      "https://replicate.delivery/x/out-1.webp",
    ]);
  });

  it("reads Replicate's single URL string", () => {
    expect(firstInpaintImageUrl("https://replicate.delivery/x/out.webp")).toBe(
      "https://replicate.delivery/x/out.webp"
    );
  });

  it("reads an older fal { image: { url } } shape", () => {
    expect(firstInpaintImageUrl({ image: { url: "https://fal.media/one.png" } })).toBe(
      "https://fal.media/one.png"
    );
  });

  it("unwraps a prediction envelope that slipped through as { output }", () => {
    expect(firstInpaintImageUrl({ id: "p1", output: ["https://replicate.delivery/y.png"] })).toBe(
      "https://replicate.delivery/y.png"
    );
  });

  it("returns [] for empty, null, non-URL, or unknown shapes", () => {
    expect(extractInpaintImageUrls(null)).toEqual([]);
    expect(extractInpaintImageUrls(undefined)).toEqual([]);
    expect(extractInpaintImageUrls({})).toEqual([]);
    expect(extractInpaintImageUrls({ images: [] })).toEqual([]);
    expect(extractInpaintImageUrls("not a url")).toEqual([]);
    expect(extractInpaintImageUrls([null, 3, "data:image/png;base64,AAA"])).toEqual([]);
    expect(firstInpaintImageUrl({ images: [{ url: null }] })).toBeNull();
  });
});
