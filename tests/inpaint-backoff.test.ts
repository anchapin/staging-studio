import { describe, expect, it } from "vitest";
import {
  createBackoff,
  jitter,
  nextDelay,
} from "@/lib/inpaint-backoff";
import type { BackoffOptions } from "@/lib/inpaint-backoff";

const OPTS: BackoffOptions = {
  intervalMs: 1000,
  maxIntervalMs: 30000,
};

describe("createBackoff", () => {
  it("starts at intervalMs", () => {
    const state = createBackoff(OPTS);
    expect(state.delayMs).toBe(1000);
  });
});

describe("jitter", () => {
  it("returns 0.5–1.0× of input", () => {
    for (let i = 0; i < 100; i++) {
      const d = jitter(1000);
      expect(d).toBeGreaterThanOrEqual(500);
      expect(d).toBeLessThanOrEqual(1000);
    }
  });

  it("produces different values across calls (spread)", () => {
    const samples = Array.from({ length: 20 }, () => jitter(1000));
    const unique = new Set(samples);
    expect(unique.size).toBeGreaterThan(1); // proves randomness
  });
});

describe("nextDelay", () => {
  it("first call returns jittered doubled intervalMs", () => {
    const state = createBackoff(OPTS);
    const delay = nextDelay(state, OPTS); // state: 1000 → 2000, returns jitter(2000)
    expect(delay).toBeGreaterThanOrEqual(1000); // jitter floor of doubled interval
    expect(delay).toBeLessThanOrEqual(3000); // jitter cap of doubled interval
  });

  it("doubles delay after each call (statistical)", () => {
    const samples: [number, number][] = [];
    for (let run = 0; run < 100; run++) {
      const state = createBackoff(OPTS);
      const d1 = nextDelay(state, OPTS);
      const d2 = nextDelay(state, OPTS);
      samples.push([d1, d2]);
    }
    // After doubling + jitter: mean(d2) ≈ 2× mean(d1), but d2 may be < d1 due to variance
    // Check that d2 is statistically larger via sign test: count how often d2 > d1
    const wins = samples.filter(([d1, d2]) => d2 > d1).length;
    // With deterministic jitter, d2 is always > d1; with random jitter, d2 > d1 ~75% of the time
    expect(wins).toBeGreaterThan(50); // majority should satisfy d2 > d1
  });

  it("caps at maxIntervalMs", () => {
    const state = createBackoff({ intervalMs: 1000, maxIntervalMs: 5000 });
    for (let i = 0; i < 10; i++) {
      nextDelay(state, { intervalMs: 1000, maxIntervalMs: 5000 });
    }
    // After many doublings, state.delayMs should be capped
    expect(state.delayMs).toBeLessThanOrEqual(5000);
  });

  it("caps including jitter", () => {
    const state = createBackoff({ intervalMs: 1000, maxIntervalMs: 30000 });
    const delays: number[] = [];
    for (let i = 0; i < 20; i++) {
      delays.push(nextDelay(state, { intervalMs: 1000, maxIntervalMs: 30000 }));
    }
    // Every delay should be ≤ 30000
    expect(delays.every((d) => d <= 30000)).toBe(true);
    // After capping starts, all delays should be ≥ 15000 (jitter floor of 30000)
    const afterCap = delays.slice(delays.findIndex((d) => d >= 16000));
    expect(afterCap.length).toBeGreaterThan(0);
    expect(afterCap.every((d) => d >= 15000)).toBe(true);
  });
});
