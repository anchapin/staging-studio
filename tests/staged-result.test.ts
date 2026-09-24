import { describe, expect, it } from "vitest";
import {
  isCompleteVariantPair,
  resolveStagedResultDisplay,
  stagedResultAlt,
  stagedVariantLabel,
  type StagedVariantPair,
} from "@/lib/staged-result";

const BEFORE_A = "https://example.com/before-a.jpg";
const AFTER_A = "https://example.com/after-a.jpg";
const BEFORE_B = "https://example.com/before-b.jpg";
const AFTER_B = "https://example.com/after-b.jpg";

const COMPLETE_A: StagedVariantPair = { before: BEFORE_A, after: AFTER_A };
const COMPLETE_B: StagedVariantPair = { before: BEFORE_B, after: AFTER_B };
const EMPTY: StagedVariantPair = { before: null, after: null };

describe("isCompleteVariantPair", () => {
  it("is true only when both before and after images exist", () => {
    expect(isCompleteVariantPair(COMPLETE_A)).toBe(true);
  });

  it("is false when either image is missing", () => {
    expect(isCompleteVariantPair(EMPTY)).toBe(false);
    expect(isCompleteVariantPair({ before: BEFORE_A, after: null })).toBe(false);
    expect(isCompleteVariantPair({ before: null, after: AFTER_A })).toBe(false);
  });
});

describe("stagedVariantLabel", () => {
  it("labels slot 0 as Variant A — staged", () => {
    expect(stagedVariantLabel(0)).toBe("Variant A — staged");
  });

  it("labels slot 1 as Variant B — staged", () => {
    expect(stagedVariantLabel(1)).toBe("Variant B — staged");
  });
});

describe("stagedResultAlt", () => {
  it("prefixes the room name", () => {
    expect(stagedResultAlt("Living room", 0)).toBe(
      "Living room staged — Variant A"
    );
    expect(stagedResultAlt("Living room", 1)).toBe(
      "Living room staged — Variant B"
    );
  });

  it("degrades without a room name", () => {
    expect(stagedResultAlt(null, 1)).toBe("Staged — Variant B");
    expect(stagedResultAlt(undefined, 0)).toBe("Staged — Variant A");
    expect(stagedResultAlt("   ", 0)).toBe("Staged — Variant A");
  });
});

describe("resolveStagedResultDisplay", () => {
  it("follows the selected variant when it is complete", () => {
    expect(
      resolveStagedResultDisplay("Den", [COMPLETE_A, COMPLETE_B], 1)
    ).toEqual({
      variantIndex: 1,
      afterImageUrl: AFTER_B,
      label: "Variant B — staged",
      alt: "Den staged — Variant B",
    });
    expect(
      resolveStagedResultDisplay("Den", [COMPLETE_A, COMPLETE_B], 0)?.variantIndex
    ).toBe(0);
  });

  it("defaults to variant A when no selection is saved", () => {
    expect(
      resolveStagedResultDisplay("Den", [COMPLETE_A, COMPLETE_B], 0)
        ?.afterImageUrl
    ).toBe(AFTER_A);
  });

  it("falls back to variant A when the selected variant is incomplete", () => {
    const result = resolveStagedResultDisplay(
      "Den",
      [COMPLETE_A, EMPTY],
      1
    );
    expect(result?.variantIndex).toBe(0);
    expect(result?.afterImageUrl).toBe(AFTER_A);
  });

  it("falls back to variant B when only B is complete", () => {
    const result = resolveStagedResultDisplay("Den", [EMPTY, COMPLETE_B], 0);
    expect(result?.variantIndex).toBe(1);
    expect(result?.afterImageUrl).toBe(AFTER_B);
  });

  it("treats a non-0/1 selection as variant A", () => {
    expect(
      resolveStagedResultDisplay("Den", [COMPLETE_A, COMPLETE_B], 5)
        ?.variantIndex
    ).toBe(0);
  });

  it("returns null when no variant is complete", () => {
    expect(resolveStagedResultDisplay("Den", [EMPTY, EMPTY], 0)).toBeNull();
    expect(
      resolveStagedResultDisplay("Den", [{ before: BEFORE_A, after: null }, EMPTY], 1)
    ).toBeNull();
  });
});
