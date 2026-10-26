import { describe, it, expect } from "vitest";
import {
  LOW_COVERAGE_WARNING_THRESHOLD,
  isMaskedPixel,
  estimateMaskCoverage,
  estimateMaskAlphaMass,
  shouldWarnLowCoverage,
} from "@/lib/mask-coverage";

describe("isMaskedPixel", () => {
  it("classifies pure white as masked", () => {
    expect(isMaskedPixel(255, 255, 255, 255)).toBe(true);
  });

  it("classifies pure black as unmasked", () => {
    expect(isMaskedPixel(0, 0, 0, 255)).toBe(false);
  });

  it("classifies gray antialiased edge pixels below 128 luminance as unmasked", () => {
    expect(isMaskedPixel(127, 127, 127, 255)).toBe(false);
  });

  it("classifies gray pixels at or above 128 luminance as masked", () => {
    expect(isMaskedPixel(128, 128, 128, 255)).toBe(true);
  });

  it("treats transparent pixels as unmasked regardless of color", () => {
    expect(isMaskedPixel(255, 255, 255, 0)).toBe(false);
    expect(isMaskedPixel(255, 255, 255, 127)).toBe(false);
    expect(isMaskedPixel(255, 255, 255, 128)).toBe(true);
  });

  it("weights luminance by channel (e.g. mid-green counts, dark blue does not)", () => {
    // 0.7152 * 200 = 143 > 128
    expect(isMaskedPixel(0, 200, 0, 255)).toBe(true);
    // 0.0722 * 255 = 18.4 < 128
    expect(isMaskedPixel(0, 0, 255, 255)).toBe(false);
  });
});

describe("estimateMaskCoverage", () => {
  const makeRgba = (pixels: Array<[number, number, number, number]>) =>
    new Uint8ClampedArray(pixels.flat());

  it("returns 0 for an all-black (empty) mask", () => {
    const data = makeRgba([
      [0, 0, 0, 255],
      [0, 0, 0, 255],
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    expect(estimateMaskCoverage(data, 2, 2)).toBe(0);
  });

  it("returns 1 for an all-white mask", () => {
    const data = makeRgba([
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
    ]);
    expect(estimateMaskCoverage(data, 2, 2)).toBe(1);
  });

  it("returns the fraction of masked pixels for a partial mask", () => {
    const data = makeRgba([
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    expect(estimateMaskCoverage(data, 2, 2)).toBe(0.5);
  });

  it("returns 0 for malformed inputs", () => {
    expect(estimateMaskCoverage(new Uint8ClampedArray(0), 2, 2)).toBe(0);
    expect(estimateMaskCoverage(new Uint8ClampedArray(4), 2, 2)).toBe(0);
    expect(estimateMaskCoverage(new Uint8ClampedArray(16), 0, 0)).toBe(0);
    expect(estimateMaskCoverage(new Uint8ClampedArray(16), -2, 2)).toBe(0);
  });

  it("treats a thin outline as a small but nonzero coverage", () => {
    // 4x4 canvas with a 1px-wide white ring (12 of 16 pixels masked).
    const W: [number, number, number, number] = [255, 255, 255, 255];
    const B: [number, number, number, number] = [0, 0, 0, 255];
    const data = makeRgba([W, W, W, W, W, B, B, W, W, B, B, W, W, W, W, W]);
    expect(estimateMaskCoverage(data, 4, 4)).toBeCloseTo(12 / 16, 5);
  });
});

describe("estimateMaskAlphaMass", () => {
  const makeRgba = (pixels: Array<[number, number, number, number]>) =>
    new Uint8ClampedArray(pixels.flat());

  it("returns 1 for a fully opaque white buffer", () => {
    const data = makeRgba([
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
    ]);
    expect(estimateMaskAlphaMass(data, 2, 2)).toBe(1);
  });

  it("returns 0 for a fully transparent buffer", () => {
    const data = makeRgba([
      [255, 255, 255, 0],
      [255, 255, 255, 0],
      [255, 255, 255, 0],
      [255, 255, 255, 0],
    ]);
    expect(estimateMaskAlphaMass(data, 2, 2)).toBe(0);
  });

  it("returns the alpha-weighted mass for a uniform 40%-opaque buffer", () => {
    const data = makeRgba([
      [255, 255, 255, 102],
      [255, 255, 255, 102],
      [255, 255, 255, 102],
      [255, 255, 255, 102],
    ]);
    expect(estimateMaskAlphaMass(data, 2, 2)).toBeCloseTo(102 / 255, 10);
    expect(estimateMaskAlphaMass(data, 2, 2)).toBeCloseTo(0.4, 10);
    // The binary estimator still reports 0 — alpha 102 is below the threshold.
    expect(estimateMaskCoverage(data, 2, 2)).toBe(0);
  });

  it("matches the probe's inline alpha-mass formula on an alpha ramp", () => {
    const W = 8;
    const H = 4;
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        rgba[o] = 255;
        rgba[o + 1] = 255;
        rgba[o + 2] = 255;
        rgba[o + 3] = Math.round((x / (W - 1)) * 255);
      }
    }
    // The inline reduce used by scripts/soft-matte-alpha-probe.mts before
    // the helper existed.
    const inline =
      rgba.reduce((acc, _v, i) => (i % 4 === 3 ? acc + rgba[i] : acc), 0) /
      (255 * W * H);
    expect(estimateMaskAlphaMass(rgba, W, H)).toBeCloseTo(inline, 12);
    expect(estimateMaskAlphaMass(rgba, W, H)).toBeGreaterThan(0);
    expect(estimateMaskAlphaMass(rgba, W, H)).toBeLessThan(1);
  });

  it("returns 0 for malformed inputs", () => {
    expect(estimateMaskAlphaMass(new Uint8ClampedArray(0), 2, 2)).toBe(0);
    expect(estimateMaskAlphaMass(new Uint8ClampedArray(4), 2, 2)).toBe(0);
    expect(estimateMaskAlphaMass(new Uint8ClampedArray(16), 0, 0)).toBe(0);
    expect(estimateMaskAlphaMass(new Uint8ClampedArray(16), -2, 2)).toBe(0);
  });
});

describe("shouldWarnLowCoverage", () => {
  it("does not warn for an empty mask (0 coverage)", () => {
    expect(shouldWarnLowCoverage(0)).toBe(false);
  });

  it("does not warn for fully masked canvas", () => {
    expect(shouldWarnLowCoverage(1)).toBe(false);
  });

  it("warns when coverage is positive but below the default threshold", () => {
    expect(shouldWarnLowCoverage(0.001)).toBe(true);
    expect(shouldWarnLowCoverage(0.0049)).toBe(true);
  });

  it("does not warn at exactly the threshold (strictly less-than semantics)", () => {
    expect(shouldWarnLowCoverage(LOW_COVERAGE_WARNING_THRESHOLD)).toBe(false);
    expect(shouldWarnLowCoverage(0.0051)).toBe(false);
  });

  it("supports a custom threshold", () => {
    expect(shouldWarnLowCoverage(0.01, 0.02)).toBe(true);
    expect(shouldWarnLowCoverage(0.03, 0.02)).toBe(false);
  });

  it("does not warn for non-finite coverage", () => {
    expect(shouldWarnLowCoverage(Number.NaN)).toBe(false);
    expect(shouldWarnLowCoverage(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("pins the default threshold at ~0.5% of pixels", () => {
    expect(LOW_COVERAGE_WARNING_THRESHOLD).toBe(0.005);
  });
});
