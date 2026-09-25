import { describe, it, expect } from "vitest";

import {
  extractMaskOutline,
  maskGridFromProviderPixels,
  paintMaskPixels,
} from "@/lib/mask-format";

const makeRgba = (pixels: Array<[number, number, number, number]>) =>
  new Uint8ClampedArray(pixels.flat());

describe("maskGridFromProviderPixels", () => {
  it("classifies a grayscale provider mask (white object on opaque black) by luminance", () => {
    // Live SAM 3.1 format (issue #248): grayscale PNGs with NO alpha
    // channel — the browser decodes every pixel fully opaque, so the
    // object is white-on-black, not a transparent-background cutout.
    const data = makeRgba([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
    ]);
    expect(Array.from(maskGridFromProviderPixels(data, 2, 2))).toEqual([0, 1, 1, 0]);
  });

  it("classifies an alpha-cutout mask by alpha (issue #228 format still supported)", () => {
    // The #228 assumption: transparent background, photo-colored (here
    // DARK) object pixels — luminance would drop the dark object, alpha
    // must win once transparency is detected.
    const data = makeRgba([
      [30, 20, 10, 255],
      [0, 0, 0, 0],
      [255, 255, 255, 255],
      [10, 10, 10, 200],
    ]);
    expect(Array.from(maskGridFromProviderPixels(data, 2, 2))).toEqual([1, 0, 1, 1]);
  });

  it("classifies the SAME geometry identically in both formats", () => {
    // 10×10, one 4×2 object at (3,4) — encoded as a grayscale mask and as
    // an alpha cutout must produce the same grid.
    const width = 10;
    const height = 10;
    const grayscale = new Uint8ClampedArray(width * height * 4);
    const cutout = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inObject = x >= 3 && x < 7 && y >= 4 && y < 6;
        const o = (y * width + x) * 4;
        grayscale[o] = inObject ? 255 : 0;
        grayscale[o + 1] = grayscale[o];
        grayscale[o + 2] = grayscale[o];
        grayscale[o + 3] = 255;
        cutout[o] = inObject ? 122 : 0;
        cutout[o + 1] = inObject ? 139 : 0;
        cutout[o + 2] = inObject ? 111 : 0;
        cutout[o + 3] = inObject ? 255 : 0;
      }
    }
    const expected = Array.from({ length: width * height }, (_, i) => {
      const x = i % width;
      const y = Math.floor(i / width);
      return x >= 3 && x < 7 && y >= 4 && y < 6 ? 1 : 0;
    });
    expect(Array.from(maskGridFromProviderPixels(grayscale, width, height))).toEqual(expected);
    expect(Array.from(maskGridFromProviderPixels(cutout, width, height))).toEqual(expected);
  });
});

describe("paintMaskPixels", () => {
  it("renders a grayscale mask as white-on-black: object pixels white/opaque, background black/opaque", () => {
    const data = makeRgba([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
    ]);
    expect(Array.from(paintMaskPixels(data, 2, 2, { maskedColor: [255, 255, 255] }))).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
  });

  it("produces the SAME white-on-black buffer from both formats of the same geometry", () => {
    const width = 4;
    const height = 2;
    const grayscale = new Uint8ClampedArray(width * height * 4);
    const cutout = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const inObject = i % 4 === 1;
      const o = i * 4;
      grayscale[o] = grayscale[o + 1] = grayscale[o + 2] = inObject ? 255 : 0;
      grayscale[o + 3] = 255;
      cutout[o + 3] = inObject ? 255 : 0;
    }
    const whiteOnBlack = paintMaskPixels(grayscale, width, height, {
      maskedColor: [255, 255, 255],
    });
    expect(Array.from(whiteOnBlack)).toEqual(
      Array.from(paintMaskPixels(cutout, width, height, { maskedColor: [255, 255, 255] }))
    );
    // Only the object cell is white; everything else is opaque black (the
    // provider/inpaint mask format: white regenerates, black preserves).
    expect(Array.from(whiteOnBlack)).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);
  });

  it("renders the overlay tint variant: masked pixels opaque in the given color, background transparent", () => {
    const data = makeRgba([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [40, 40, 40, 255],
    ]);
    expect(
      Array.from(
        paintMaskPixels(data, 2, 2, {
          maskedColor: [34, 197, 94],
          transparentBackground: true,
        })
      )
    ).toEqual([
      0, 0, 0, 0,
      34, 197, 94, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
  });
});

describe("extractMaskOutline", () => {
  // Issue #249: detected-only instances render as a faint wash PLUS a
  // rank-colored outline; selected ones stay a solid fill. The outline is
  // the boundary ring of the format-agnostic classification — interior
  // object pixels and background stay fully transparent.
  const OUTLINE: readonly [number, number, number] = [217, 119, 6];

  it("outlines only the boundary ring of a solid object, leaving the interior transparent", () => {
    // 5×5 with a 3×3 object at (1,1): 8 boundary pixels, 1 interior pixel.
    const width = 5;
    const height = 5;
    const grayscale = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      const inObject = x >= 1 && x <= 3 && y >= 1 && y <= 3;
      const o = i * 4;
      grayscale[o] = grayscale[o + 1] = grayscale[o + 2] = inObject ? 255 : 0;
      grayscale[o + 3] = 255;
    }
    const out = extractMaskOutline(grayscale, width, height, { outlineColor: OUTLINE });

    const isOutline = (x: number, y: number) => {
      const o = (y * width + x) * 4;
      return (
        out[o] === OUTLINE[0] && out[o + 1] === OUTLINE[1] && out[o + 2] === OUTLINE[2] && out[o + 3] === 255
      );
    };
    const isTransparent = (x: number, y: number) => {
      const o = (y * width + x) * 4;
      return out[o + 3] === 0;
    };
    // Boundary ring: all 3×3-object pixels except the (2,2) interior.
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        if (x === 2 && y === 2) {
          expect(isTransparent(x, y), `interior (${x},${y}) must be transparent`).toBe(true);
        } else {
          expect(isOutline(x, y), `boundary (${x},${y}) must be outlined`).toBe(true);
        }
      }
    }
    // Background corners stay transparent.
    expect(isTransparent(0, 0)).toBe(true);
    expect(isTransparent(4, 4)).toBe(true);
  });

  it("treats the canvas edge as a boundary (off-grid neighbor = background)", () => {
    // 3×1 object spanning the full 3×1 canvas: every pixel borders the
    // canvas edge, so all three are outline pixels.
    const data = makeRgba([
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
    ]);
    const out = extractMaskOutline(data, 3, 1, { outlineColor: OUTLINE });
    for (let x = 0; x < 3; x++) {
      const o = x * 4;
      expect(Array.from(out.slice(o, o + 3))).toEqual([...OUTLINE]);
      expect(out[o + 3]).toBe(255);
    }
  });

  it("produces the SAME outline from both encodings of the same geometry", () => {
    const width = 4;
    const height = 4;
    const grayscale = new Uint8ClampedArray(width * height * 4);
    const cutout = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      const inObject = x >= 1 && x <= 2 && y >= 0 && y <= 2;
      const o = i * 4;
      grayscale[o] = grayscale[o + 1] = grayscale[o + 2] = inObject ? 255 : 0;
      grayscale[o + 3] = 255;
      cutout[o + 3] = inObject ? 255 : 0;
    }
    expect(
      Array.from(extractMaskOutline(grayscale, width, height, { outlineColor: OUTLINE }))
    ).toEqual(Array.from(extractMaskOutline(cutout, width, height, { outlineColor: OUTLINE })));
  });

  it("returns an all-transparent buffer for an empty mask", () => {
    const width = 2;
    const height = 2;
    const data = new Uint8ClampedArray(width * height * 4); // opaque black
    for (let i = 0; i < width * height; i++) data[i * 4 + 3] = 255;
    const out = extractMaskOutline(data, width, height, { outlineColor: OUTLINE });
    expect(Array.from(out)).toEqual(new Array(width * height * 4).fill(0));
  });
});
