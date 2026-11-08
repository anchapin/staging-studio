/**
 * Pixel-helper tests for the GPT-Image provider (issue #1506).
 *
 * The load-bearing invariant is the #1502 correction: the guidance
 * mask's alpha must be 255 at EVERY pixel, for both mask formats the
 * dispatch seam produces (grayscale white-on-black and alpha cutout).
 * The composite tests pin the #1504 contract: outside the mask the
 * source photo is returned pixel-identical; deep inside, the model
 * output wins.
 */
import { describe, expect, it } from "vitest";

import {
  compositeEditedRegion,
  guidanceMaskPixels,
  resizeRgbaBilinear,
} from "@/lib/gpt-image-mask";

const W = 8;
const H = 8;

function grayscaleMask(): Uint8Array {
  // White (edit) square covering x in [2,5], y in [2,5] on black.
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const inside = x >= 2 && x <= 5 && y >= 2 && y <= 5;
      const v = inside ? 255 : 0;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return data;
}

function alphaCutoutMask(): Uint8Array {
  // Same region expressed as an alpha cutout: transparent background,
  // opaque photo-colored object pixels.
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const inside = x >= 2 && x <= 5 && y >= 2 && y <= 5;
      if (inside) {
        data[o] = 200;
        data[o + 1] = 30;
        data[o + 2] = 30;
        data[o + 3] = 255;
      } else {
        data[o + 3] = 0;
      }
    }
  }
  return data;
}

function expectGuidanceShape(out: Uint8Array) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const inside = x >= 2 && x <= 5 && y >= 2 && y <= 5;
      const expected = inside ? 0 : 255;
      expect(out[o]).toBe(expected);
      expect(out[o + 1]).toBe(expected);
      expect(out[o + 2]).toBe(expected);
      // The #1502 invariant: alpha never varies.
      expect(out[o + 3]).toBe(255);
    }
  }
}

describe("guidanceMaskPixels", () => {
  it("encodes a grayscale white-on-black mask as black=edit on opaque white", () => {
    expectGuidanceShape(guidanceMaskPixels(grayscaleMask(), W, H));
  });

  it("encodes an alpha-cutout mask identically (classification keys on alpha)", () => {
    expectGuidanceShape(guidanceMaskPixels(alphaCutoutMask(), W, H));
  });
});

describe("resizeRgbaBilinear", () => {
  it("is the identity at equal dimensions", () => {
    const src = grayscaleMask();
    const out = resizeRgbaBilinear(src, W, H, W, H);
    expect(Array.from(out)).toEqual(Array.from(src));
  });

  it("keeps a uniform field uniform at any size", () => {
    const src = new Uint8Array(4 * 4 * 4).fill(77);
    const out = resizeRgbaBilinear(src, 4, 4, 16, 16);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBe(77);
  });
});

describe("compositeEditedRegion", () => {
  const grid = (() => {
    const g = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x >= 2 && x <= 5 && y >= 2 && y <= 5) g[y * W + x] = 1;
      }
    }
    return g;
  })();
  const source = new Uint8Array(W * H * 4).fill(40);
  const generated = new Uint8Array(W * H * 4).fill(210);

  it("returns the source pixel-identical far outside the mask", () => {
    const out = compositeEditedRegion(source, generated, grid, W, H, 2);
    for (const [x, y] of [
      [0, 0],
      [7, 0],
      [0, 7],
      [7, 7],
    ] as const) {
      const o = (y * W + x) * 4;
      expect(out[o]).toBe(40);
    }
  });

  it("returns the generated pixel deep inside the mask", () => {
    const out = compositeEditedRegion(source, generated, grid, W, H, 2);
    const o = (3 * W + 3) * 4;
    expect(out[o]).toBe(210);
    expect(out[o + 3]).toBe(255);
  });
});
