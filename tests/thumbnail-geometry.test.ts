/**
 * Unit tests for `computeThumbnailSize` (issue #1415).
 *
 * The pure-math extraction lives in `src/lib/thumbnail-geometry.ts`;
 * this file pins the contract that `src/lib/inpaint-thumbnail.ts`
 * previously held inline. The legacy implementation lived inside a
 * browser-only Image / canvas glue module and was untested per AGENTS.md
 * (the "Genuinely untested today" list explicitly called this file
 * out).
 *
 * Why this matters: every version-history thumbnail in the studio's
 * refine page goes through these exact dimension calculations. A
 * regression here silently shows up as either a blown-up layout
 * (no scale applied) or a 1×1 stub (over-aggressive rounding) — both
 * ship-looking without raising any alerts.
 */
import { describe, expect, it } from "vitest";
import { computeThumbnailSize } from "@/lib/thumbnail-geometry";

describe("computeThumbnailSize", () => {
  it("scales the dominant axis to maxDim and the other proportionally", () => {
    // 4000×3000 (4:3) at maxDim 200 → 200 wide × 150 tall.
    const out = computeThumbnailSize(4000, 3000, 200);
    expect(out).toEqual({ width: 200, height: 150 });
  });

  it("scales taller portrait images by height", () => {
    // 1080×1920 (vertical phone shot) at maxDim 200 → ~113×200.
    const out = computeThumbnailSize(1080, 1920, 200);
    expect(out).toEqual({ width: 113, height: 200 });
  });

  it("never upscales — natural dimensions smaller than maxDim round-trip", () => {
    const out = computeThumbnailSize(150, 100, 200);
    expect(out).toEqual({ width: 150, height: 100 });
  });

  it("rounds to the nearest integer and clamps to a minimum of 1", () => {
    // Even on a 1×1 image at any maxDim, the output is 1×1 (Math.min(1, ...)
    // caps the scale).
    expect(computeThumbnailSize(1, 1, 200)).toEqual({ width: 1, height: 1 });
    // Same when naturalWidth === naturalHeight === maxDim — no scale
    // applied, dimensions round-trip.
    expect(computeThumbnailSize(200, 200, 200)).toEqual({
      width: 200,
      height: 200,
    });
  });

  it("handles pathological zero-axis inputs without throwing", () => {
    // 0×0 (broken image headers) → 1×1 (matches the legacy guard).
    expect(computeThumbnailSize(0, 0, 200)).toEqual({ width: 1, height: 1 });
    // 0×1000 → 0 wide would be invalid; the Math.max(1, …) clamp
    // produces 1×200 instead.
    expect(computeThumbnailSize(0, 1000, 200)).toEqual({ width: 1, height: 200 });
  });

  it("default maxDim is 200", () => {
    // No third arg: behaviour pins the same default the legacy code used.
    expect(computeThumbnailSize(1000, 750)).toEqual({ width: 200, height: 150 });
  });

  it("produces whole-pixel dimensions for every reasonable input shape", () => {
    // Sanity check across several aspect ratios — both axes must be
    // integers (rounded), never floats that would render as half-pixels
    // in CSS.
    const cases: Array<[number, number, number]> = [
      [640, 480, 200],
      [1920, 1080, 320],
      [800, 600, 150],
      [4032, 3024, 512],
      [3000, 4000, 256],
    ];
    for (const [w, h, m] of cases) {
      const out = computeThumbnailSize(w, h, m);
      expect(Number.isInteger(out.width), `width ${out.width} from ${w}x${h}/${m}`).toBe(true);
      expect(Number.isInteger(out.height), `height ${out.height} from ${w}x${h}/${m}`).toBe(true);
      expect(out.width).toBeGreaterThanOrEqual(1);
      expect(out.height).toBeGreaterThanOrEqual(1);
    }
  });
});
