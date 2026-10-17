/**
 * FineTune wire-shape helpers (issue #1362b, Stage B).
 *
 * Two helpers under test:
 *  - `clamp(value, min, max)` — bounds the 0..100 UI strength to the
 *    0..1 DashScope wire range. Three pins cover the
 *    below/within/above branches.
 *  - `parseSeedOrUndefined(value)` — parses the persisted
 *    `Room.fineTuneSeed` (digits-only string) into a `number` for
 *    the wire. Six pins cover the documented edge cases: null /
 *    undefined / empty / whitespace / non-digits / valid / leading-
 *    zeros / max-length.
 *
 * Pure logic; vitest's `node` environment is fine.
 */
import { describe, expect, it } from "vitest";
import { clamp, parseSeedOrUndefined } from "@/lib/finetune-wire";

describe("clamp (issue #1362b)", () => {
  it("returns the value unchanged when it is within [min, max]", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it("returns min when the value is below the range", () => {
    expect(clamp(-0.1, 0, 1)).toBe(0);
    expect(clamp(-5, 0, 100)).toBe(0);
  });

  it("returns max when the value is above the range", () => {
    expect(clamp(1.5, 0, 1)).toBe(1);
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it("preserves the boundary values exactly (clamp(0, 0, 1) === 0)", () => {
    expect(clamp(0, 0, 1)).toBe(0);
    expect(clamp(1, 0, 1)).toBe(1);
  });
});

describe("parseSeedOrUndefined (issue #1362b)", () => {
  it("returns undefined for null / undefined (no seed ⇒ DashScope rolls fresh)", () => {
    expect(parseSeedOrUndefined(null)).toBeUndefined();
    expect(parseSeedOrUndefined(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string and whitespace-only input", () => {
    expect(parseSeedOrUndefined("")).toBeUndefined();
    expect(parseSeedOrUndefined("   ")).toBeUndefined();
    expect(parseSeedOrUndefined("\t\n")).toBeUndefined();
  });

  it("returns undefined when the input contains non-digit characters", () => {
    // The FineTune UI already strips non-digits at the input layer,
    // but this is the wire-shape helper's contract: defense in depth.
    expect(parseSeedOrUndefined("12a45")).toBeUndefined();
    expect(parseSeedOrUndefined("1234.5")).toBeUndefined();
    expect(parseSeedOrUndefined("-123")).toBeUndefined();
    expect(parseSeedOrUndefined("12 34")).toBeUndefined();
  });

  it("parses a digits-only string into a number", () => {
    expect(parseSeedOrUndefined("42")).toBe(42);
    expect(parseSeedOrUndefined("12345")).toBe(12345);
  });

  it("preserves leading zeros (Number.parseInt semantics)", () => {
    // `parseInt("00042", 10) === 42`; we don't reject leading zeros
    // — the user's "00042" should be honored as seed 42 on the next
    // run, just like every other DashScope seed.
    expect(parseSeedOrUndefined("00042")).toBe(42);
  });

  it("accepts the schema-cap boundary at 6 digits (999999)", () => {
    // `roomMetadataSchema.fineTuneSeed` is digits-only, max 6 chars
    // — exactly DashScope's wire range. The 6-digit value passes
    // through unchanged; no further clamping is needed here.
    expect(parseSeedOrUndefined("999999")).toBe(999999);
  });

  it("trims leading/trailing whitespace before parsing", () => {
    expect(parseSeedOrUndefined("  42  ")).toBe(42);
  });
});