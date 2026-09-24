import { describe, expect, it } from "vitest";

import { estimateMaskCoverage, shouldWarnLowCoverage } from "@/lib/mask-coverage";
import {
  DEFAULT_HOLISTIC_MASK_STRATEGY_ID,
  HOLISTIC_MASK_STRATEGIES,
  buildFeatheredFrameMask,
  buildFullFrameMask,
  buildWallBandMask,
  getHolisticMaskStrategy,
  type HolisticMaskImage,
} from "@/lib/holistic-mask";

function luminanceAt(mask: HolisticMaskImage, x: number, y: number): number {
  const o = (y * mask.width + x) * 4;
  return Math.round(
    0.2126 * mask.data[o] + 0.7152 * mask.data[o + 1] + 0.0722 * mask.data[o + 2]
  );
}

function expectOpaqueEverywhere(mask: HolisticMaskImage): void {
  for (let i = 3; i < mask.data.length; i += 4) {
    expect(mask.data[i]).toBe(255);
  }
}

describe("geometry validation", () => {
  const badDims: readonly [number, number][] = [
    [0, 10],
    [10, 0],
    [-4, 10],
    [10, -4],
    [3.5, 10],
    [10, 3.5],
    [NaN, 10],
    [10, NaN],
  ];

  it.each(badDims)("rejects malformed dims %d x %d", (width, height) => {
    expect(buildFullFrameMask(width, height)).toBeNull();
    expect(buildFeatheredFrameMask(width, height)).toBeNull();
    expect(buildWallBandMask(width, height)).toBeNull();
  });
});

describe("buildFullFrameMask (a1/a2 candidate)", () => {
  it("paints every pixel white at full alpha", () => {
    const mask = buildFullFrameMask(32, 24);
    expect(mask).not.toBeNull();
    if (!mask) return;

    expectOpaqueEverywhere(mask);
    for (let i = 0; i < mask.data.length; i += 4) {
      expect(mask.data[i]).toBe(255);
      expect(mask.data[i + 1]).toBe(255);
      expect(mask.data[i + 2]).toBe(255);
    }
  });

  it("estimates exactly 100% coverage", () => {
    const mask = buildFullFrameMask(64, 48);
    if (!mask) throw new Error("mask unexpectedly null");
    expect(estimateMaskCoverage(mask.data, mask.width, mask.height)).toBe(1);
  });
});

describe("buildFeatheredFrameMask (TV-frame adherence candidate)", () => {
  it("ramps monotonically from a preserved black rim to a white interior", () => {
    const mask = buildFeatheredFrameMask(512, 512);
    expect(mask).not.toBeNull();
    if (!mask) return;

    expectOpaqueEverywhere(mask);
    // Default feather: floor(0.06 * 512) = 30px ramp.
    expect(luminanceAt(mask, 0, 0)).toBe(0);
    expect(luminanceAt(mask, 0, 256)).toBe(0);
    let previous = -1;
    for (let x = 0; x <= 128; x++) {
      const value = luminanceAt(mask, x, 256);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(luminanceAt(mask, 256, 256)).toBe(255);
    expect(luminanceAt(mask, 100, 100)).toBe(255);
  });

  it("covers most of the canvas but strictly less than full-frame", () => {
    const mask = buildFeatheredFrameMask(512, 512);
    if (!mask) throw new Error("mask unexpectedly null");
    const coverage = estimateMaskCoverage(mask.data, mask.width, mask.height);
    expect(coverage).toBeGreaterThan(0.5);
    expect(coverage).toBeLessThan(1);
  });

  it("degenerates to full-frame when the feather ratio is 0 or non-finite", () => {
    const zero = buildFeatheredFrameMask(64, 64, { featherRatio: 0 });
    const nan = buildFeatheredFrameMask(64, 64, { featherRatio: NaN });
    if (!zero || !nan) throw new Error("mask unexpectedly null");

    expect(estimateMaskCoverage(zero.data, zero.width, zero.height)).toBe(1);
    expect(estimateMaskCoverage(nan.data, nan.width, nan.height)).toBe(1);
  });

  it("clamps an oversized feather ratio instead of failing", () => {
    const mask = buildFeatheredFrameMask(100, 100, { featherRatio: 0.9 });
    expect(mask).not.toBeNull();
    if (!mask) return;
    const coverage = estimateMaskCoverage(mask.data, mask.width, mask.height);
    expect(coverage).toBeGreaterThan(0);
    expect(coverage).toBeLessThan(1);
  });

  it("is deterministic", () => {
    const a = buildFeatheredFrameMask(80, 60);
    const b = buildFeatheredFrameMask(80, 60);
    if (!a || !b) throw new Error("mask unexpectedly null");
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });
});

describe("buildWallBandMask (pre-registered default winner)", () => {
  it("preserves hard ceiling and floor strips with exact coverage math", () => {
    const mask = buildWallBandMask(512, 512);
    expect(mask).not.toBeNull();
    if (!mask) return;

    expectOpaqueEverywhere(mask);
    // Defaults 0.14 / 0.16, feather 0: band rows are
    // [floor(0.14*h), h - floor(0.16*h)) = [71, 431).
    expect(luminanceAt(mask, 256, 0)).toBe(0);
    expect(luminanceAt(mask, 256, 70)).toBe(0);
    expect(luminanceAt(mask, 256, 71)).toBe(255);
    expect(luminanceAt(mask, 256, 430)).toBe(255);
    expect(luminanceAt(mask, 256, 431)).toBe(0);
    expect(luminanceAt(mask, 256, 511)).toBe(0);

    expect(estimateMaskCoverage(mask.data, mask.width, mask.height)).toBe(
      (431 - 71) / 512
    );
  });

  it("honors custom band ratios", () => {
    const mask = buildWallBandMask(100, 100, { topRatio: 0.2, bottomRatio: 0.2 });
    if (!mask) throw new Error("mask unexpectedly null");
    expect(estimateMaskCoverage(mask.data, mask.width, mask.height)).toBe(60 / 100);
  });

  it("softens band edges with the feather ramp", () => {
    const mask = buildWallBandMask(100, 100, {
      topRatio: 0.14,
      bottomRatio: 0.16,
      featherRatio: 0.02,
    });
    if (!mask) throw new Error("mask unexpectedly null");

    // featherPx = floor(0.02 * 100) = 2; band starts at y=14.
    const top = luminanceAt(mask, 50, 14);
    const mid = luminanceAt(mask, 50, 15);
    const inner = luminanceAt(mask, 50, 16);
    expect(top).toBeLessThan(mid);
    expect(mid).toBeLessThan(inner);
    expect(inner).toBe(255);
  });

  it("returns null when the clamped ratios leave no band", () => {
    expect(buildWallBandMask(100, 100, { topRatio: 0.6, bottomRatio: 0.6 })).toBeNull();
  });

  it("treats non-finite ratios as 0", () => {
    const mask = buildWallBandMask(100, 100, { topRatio: NaN });
    if (!mask) throw new Error("mask unexpectedly null");
    // No ceiling strip; floor strip 0.16 remains preserved.
    expect(estimateMaskCoverage(mask.data, mask.width, mask.height)).toBe(84 / 100);
  });
});

describe("strategy registry", () => {
  it("lists exactly the three issue-#190 candidates with unique ids", () => {
    expect(HOLISTIC_MASK_STRATEGIES.map((s) => s.id)).toEqual([
      "full-frame",
      "feathered-frame",
      "wall-band",
    ]);
  });

  it("resolves strategies by id and rejects unknown ids", () => {
    for (const strategy of HOLISTIC_MASK_STRATEGIES) {
      expect(getHolisticMaskStrategy(strategy.id)?.id).toBe(strategy.id);
    }
    expect(getHolisticMaskStrategy("nope")).toBeNull();
  });

  it("builds an opaque mask for every registered strategy", () => {
    for (const strategy of HOLISTIC_MASK_STRATEGIES) {
      const mask = strategy.build(64, 64);
      expect(mask, strategy.id).not.toBeNull();
      if (mask) expectOpaqueEverywhere(mask);
    }
  });

  it("pre-registers a default winner that exists in the registry", () => {
    expect(getHolisticMaskStrategy(DEFAULT_HOLISTIC_MASK_STRATEGY_ID)).not.toBeNull();
    expect(DEFAULT_HOLISTIC_MASK_STRATEGY_ID).toBe("wall-band");
  });
});

describe("interplay with mask-coverage validation (issue #190 verification)", () => {
  it("never trips the low-coverage warning for holistic masks", () => {
    for (const strategy of HOLISTIC_MASK_STRATEGIES) {
      const mask = strategy.build(512, 512);
      if (!mask) throw new Error("mask unexpectedly null");
      const coverage = estimateMaskCoverage(mask.data, mask.width, mask.height);
      expect(shouldWarnLowCoverage(coverage), strategy.id).toBe(false);
    }
  });

  it("confirms ~100% coverage passes while single-object mistakes still warn", () => {
    // Holistic path: full coverage is accepted — the warning only fires
    // BELOW the threshold on a non-empty mask, so no change to
    // mask-coverage.ts was needed for the holistic path.
    expect(shouldWarnLowCoverage(1)).toBe(false);
    expect(shouldWarnLowCoverage(0.9)).toBe(false);
    // Single-object brush validation unchanged:
    expect(shouldWarnLowCoverage(0)).toBe(false);
    expect(shouldWarnLowCoverage(0.004)).toBe(true);
    expect(shouldWarnLowCoverage(0.006)).toBe(false);
  });
});
