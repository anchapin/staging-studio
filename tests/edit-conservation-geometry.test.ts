/**
 * Unit tests for `computeConservationSampleSize` (issue #1513).
 *
 * The pure-math extraction lives in `src/lib/edit-conservation-geometry.ts`;
 * this file pins the contract that `src/lib/edit-conservation-measure.ts`
 * previously held inline. The legacy implementation lived inside a
 * browser-only Image / canvas glue module and was untested per AGENTS.md
 * (the "Genuinely untested today" list explicitly called this file
 * out).
 *
 * Why this matters: every conservation sample is taken at a fixed width
 * with a height derived from the source aspect ratio. A regression here
 * silently changes the pixel budget of the conservation check — either a
 * 0px-tall frame (a canvas that cannot be read) or an uncapped height
 * (a very tall panorama sampling far more pixels than intended).
 */
import { describe, expect, it } from "vitest";
import {
  computeConservationSampleSize,
  CONSERVATION_SAMPLE_WIDTH,
  CONSERVATION_MAX_SAMPLE_HEIGHT,
} from "@/lib/edit-conservation-geometry";

describe("computeConservationSampleSize", () => {
  it("samples landscape images at the fixed width with a proportional height", () => {
    // 4000×3000 (4:3) → 256 wide × 192 tall.
    expect(computeConservationSampleSize(4000, 3000)).toEqual({
      width: 256,
      height: 192,
    });
  });

  it("samples portrait images at the fixed width with a taller height", () => {
    // 1080×1920 (vertical phone shot) → 256 wide × 455 tall.
    expect(computeConservationSampleSize(1080, 1920)).toEqual({
      width: 256,
      height: 455,
    });
  });

  it("samples square images at 256×256", () => {
    expect(computeConservationSampleSize(1000, 1000)).toEqual({
      width: 256,
      height: 256,
    });
    expect(computeConservationSampleSize(256, 256)).toEqual({
      width: 256,
      height: 256,
    });
  });

  it("caps the sampled height for extremely tall images", () => {
    // 100×10000 → 25600px unclamped, capped at CONSERVATION_MAX_SAMPLE_HEIGHT.
    expect(computeConservationSampleSize(100, 10000)).toEqual({
      width: 256,
      height: 1024,
    });
    expect(CONSERVATION_MAX_SAMPLE_HEIGHT).toBe(1024);
  });

  it("floors the sampled height at 1 for extremely wide images", () => {
    // 10000×10 → 0.256px unclamped, rounded to 0, floored to 1.
    expect(computeConservationSampleSize(10000, 10)).toEqual({
      width: 256,
      height: 1,
    });
  });

  it("rounds the height to the nearest integer (half-pixel case rounds up)", () => {
    // 256 * 5 / 512 = 2.5 exactly → Math.round → 3.
    expect(computeConservationSampleSize(512, 5)).toEqual({
      width: 256,
      height: 3,
    });
    // 256 * 3 / 512 = 1.5 exactly → Math.round → 2.
    expect(computeConservationSampleSize(512, 3)).toEqual({
      width: 256,
      height: 2,
    });
  });

  it("always samples at the fixed sample width", () => {
    expect(CONSERVATION_SAMPLE_WIDTH).toBe(256);
    for (const [w, h] of [
      [4000, 3000],
      [1080, 1920],
      [1, 1],
      [10000, 10],
      [100, 10000],
    ] as Array<[number, number]>) {
      expect(computeConservationSampleSize(w, h).width).toBe(
        CONSERVATION_SAMPLE_WIDTH,
      );
    }
  });

  it("produces whole-pixel dimensions within the allowed range", () => {
    const cases: Array<[number, number]> = [
      [640, 480],
      [1920, 1080],
      [800, 600],
      [4032, 3024],
      [3000, 4000],
      [512, 5],
      [10000, 10],
      [100, 10000],
    ];
    for (const [w, h] of cases) {
      const out = computeConservationSampleSize(w, h);
      expect(Number.isInteger(out.width), `width ${out.width} from ${w}x${h}`).toBe(
        true,
      );
      expect(
        Number.isInteger(out.height),
        `height ${out.height} from ${w}x${h}`,
      ).toBe(true);
      expect(out.width).toBe(CONSERVATION_SAMPLE_WIDTH);
      expect(out.height).toBeGreaterThanOrEqual(1);
      expect(out.height).toBeLessThanOrEqual(CONSERVATION_MAX_SAMPLE_HEIGHT);
    }
  });
});
