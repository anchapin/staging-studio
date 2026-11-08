/**
 * Issue #1457 — the segment→inpaint dispatch seam.
 *
 * Pins the ONE seam every dispatched mask passes through
 * (`beginInpaintRun` in `src/components/canvas/use-inpaint-runs.ts`):
 * the mask handed to `POST /api/inpaint` must come out of the pinned
 * `prepareSegmentMaskGrid` composition — eroded by the DOCUMENTED 4 px
 * default (`DEFAULT_SEGMENT_MASK_EROSION_RADIUS`) — while everything
 * else about the mask (its colour, its format, its feathered alpha)
 * stays intact.
 *
 * The pixel math is DOM-free, so it is unit-tested here; the browser
 * PNG codec is exercised through an injected fake codec, which pins the
 * seam function itself (not just its pixel math).
 */

import { describe, expect, it } from "vitest";

import {
  prepareMaskForDispatch,
  prepareMaskPixelsForDispatch,
  type DecodedMaskPixels,
  type MaskCodec,
} from "@/lib/mask-dispatch-prepare";
import { DEFAULT_SEGMENT_MASK_EROSION_RADIUS } from "@/lib/mask-erosion";
import { isMaskedPixel } from "@/lib/mask-coverage";

/** An opaque grayscale (white-on-black) mask — the luminance format. */
function opaqueMask(
  width: number,
  height: number,
  isPainted: (x: number, y: number) => boolean
): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const value = isPainted(x, y) ? 255 : 0;
      data[o] = value;
      data[o + 1] = value;
      data[o + 2] = value;
      data[o + 3] = 255;
    }
  }
  return data;
}

/** An alpha-cutout mask (transparent background) — the alpha format. */
function cutoutMask(
  width: number,
  height: number,
  isPainted: (x: number, y: number) => boolean
): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (isPainted(x, y)) {
        data[o] = 255;
        data[o + 1] = 255;
        data[o + 2] = 255;
        data[o + 3] = 255;
      }
    }
  }
  return data;
}

/**
 * True when the pixel of an RGBA buffer counts as painted — the
 * repo-wide rule (`isMaskedPixel`): opaque ENOUGH and bright ENOUGH.
 * Works for both mask formats (an alpha cutout's painted pixels are
 * opaque white; a grayscale mask's painted pixels are opaque white).
 */
function isPaintedPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number
): boolean {
  const o = (y * width + x) * 4;
  return isMaskedPixel(data[o], data[o + 1], data[o + 2], data[o + 3]);
}

/** The bounding box of the painted region, in pixels. */
function paintedBounds(data: Uint8ClampedArray, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isPaintedPixel(data, width, x, y)) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, count };
}

describe("prepareMaskPixelsForDispatch (issue #1457 dispatch seam)", () => {
  const SIZE = 64;
  // A filled square that touches no canvas edge, so the erosion is not
  // clamped by the "out-of-grid neighbours are ignored" rule.
  const square = (x: number, y: number) =>
    x >= 10 && x < 50 && y >= 10 && y < 50;

  it("erodes the painted region by the documented 4 px default", () => {
    const input = opaqueMask(SIZE, SIZE, square);
    const output = prepareMaskPixelsForDispatch(input, SIZE, SIZE);

    expect(output).not.toBeNull();
    const bounds = paintedBounds(output!, SIZE, SIZE);

    // Every straight edge moves inward by exactly the default radius.
    expect(DEFAULT_SEGMENT_MASK_EROSION_RADIUS).toBe(4);
    expect(bounds.minX).toBe(14);
    expect(bounds.minY).toBe(14);
    expect(bounds.maxX).toBe(45);
    expect(bounds.maxY).toBe(45);
    expect(bounds.count).toBeLessThan(paintedBounds(input, SIZE, SIZE).count);
    expect(bounds.count).toBeGreaterThan(0);
  });

  it("uses the default radius when the caller passes no options", () => {
    const input = opaqueMask(SIZE, SIZE, square);
    const implicit = prepareMaskPixelsForDispatch(input, SIZE, SIZE);
    const explicit = prepareMaskPixelsForDispatch(input, SIZE, SIZE, {
      erosionRadius: DEFAULT_SEGMENT_MASK_EROSION_RADIUS,
    });

    expect(implicit).not.toBeNull();
    expect(Array.from(implicit!)).toEqual(Array.from(explicit!));
  });

  it("leaves the mask intact when the erosion is disabled", () => {
    const input = opaqueMask(SIZE, SIZE, square);
    const output = prepareMaskPixelsForDispatch(input, SIZE, SIZE, {
      erosionRadius: 0,
    });

    expect(output).not.toBeNull();
    expect(Array.from(output!)).toEqual(Array.from(input));
  });

  it("fills enclosed holes so no donut reaches the provider", () => {
    // A white ring with an unpainted pocket in the middle.
    const donut = (x: number, y: number) =>
      x >= 10 && x < 50 && y >= 10 && y < 50 && !(x >= 26 && x < 38 && y >= 26 && y < 38);
    const input = opaqueMask(SIZE, SIZE, donut);

    // The hole is unpainted in the input …
    expect(isPaintedPixel(input, SIZE, 32, 32)).toBe(false);
    // … and painted after the preparation (hole fill is on by default).
    const output = prepareMaskPixelsForDispatch(input, SIZE, SIZE);
    expect(output).not.toBeNull();
    expect(isPaintedPixel(output!, SIZE, 32, 32)).toBe(true);
  });

  it("keeps the alpha-cutout format of a segment mask", () => {
    const input = cutoutMask(SIZE, SIZE, square);
    const output = prepareMaskPixelsForDispatch(input, SIZE, SIZE);

    expect(output).not.toBeNull();
    // Painted pixels keep their alpha (a feathered mask keeps its edge),
    // unpainted pixels become fully transparent — the cutout format the
    // provider understands.
    expect(output![(20 * SIZE + 20) * 4 + 3]).toBe(255);
    expect(output![(2 * SIZE + 2) * 4 + 3]).toBe(0);
    // The region itself is still eroded by the default radius.
    expect(paintedBounds(output!, SIZE, SIZE).minX).toBe(14);
  });

  it("returns null for malformed geometry", () => {
    const input = opaqueMask(SIZE, SIZE, square);
    expect(prepareMaskPixelsForDispatch(input, 0, SIZE)).toBeNull();
    expect(prepareMaskPixelsForDispatch(input, SIZE, 0)).toBeNull();
    expect(prepareMaskPixelsForDispatch(input, 1.5, SIZE)).toBeNull();
    expect(prepareMaskPixelsForDispatch(new Uint8ClampedArray(4), 3, 3)).toBeNull();
  });

  it("never mutates the input buffer", () => {
    const input = opaqueMask(SIZE, SIZE, square);
    const before = Array.from(input);
    prepareMaskPixelsForDispatch(input, SIZE, SIZE);
    expect(Array.from(input)).toEqual(before);
  });
});

describe("prepareMaskForDispatch (issue #1457 seam function)", () => {
  const SIZE = 64;
  const square = (x: number, y: number) =>
    x >= 10 && x < 50 && y >= 10 && y < 50;

  /** A codec that records what the seam hands back to the encoder. */
  function fakeCodec(data: Uint8ClampedArray<ArrayBuffer>): {
    codec: MaskCodec;
    encoded: DecodedMaskPixels[];
  } {
    const encoded: DecodedMaskPixels[] = [];
    return {
      encoded,
      codec: {
        async decode() {
          return { data, width: SIZE, height: SIZE };
        },
        encode(pixels) {
          encoded.push(pixels);
          return "data:image/png;base64,PREPARED";
        },
      },
    };
  }

  it("prepares the mask with the default 4 px erosion before dispatch", async () => {
    const { codec, encoded } = fakeCodec(opaqueMask(SIZE, SIZE, square));

    const result = await prepareMaskForDispatch(
      "data:image/png;base64,INPUT",
      undefined,
      codec
    );

    expect(result).toBe("data:image/png;base64,PREPARED");
    expect(encoded).toHaveLength(1);
    expect(encoded[0].width).toBe(SIZE);
    expect(encoded[0].height).toBe(SIZE);
    expect(paintedBounds(encoded[0].data, SIZE, SIZE).minX).toBe(14);
  });

  it("dispatches the mask unchanged when it cannot be decoded", async () => {
    const codec: MaskCodec = {
      async decode() {
        return null;
      },
      encode() {
        throw new Error("must not encode");
      },
    };

    const input = "data:image/png;base64,INPUT";
    expect(await prepareMaskForDispatch(input, undefined, codec)).toBe(input);
  });

  it("dispatches the mask unchanged when the preparation fails", async () => {
    const codec: MaskCodec = {
      async decode() {
        return { data: new Uint8ClampedArray(4), width: 3, height: 3 };
      },
      encode() {
        throw new Error("must not encode");
      },
    };

    const input = "data:image/png;base64,INPUT";
    expect(await prepareMaskForDispatch(input, undefined, codec)).toBe(input);
  });
});
