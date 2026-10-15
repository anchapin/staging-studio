/**
 * Issue #1340 — `<VersionStrip>` + Lookbook slot.
 *
 * Pins the pure slot → variant-index resolver the server action, API
 * route, and version strip all consume. The reciprocal mapping
 * (`variantIndexToSlotId`) lives in `src/components/edit-room/data.ts`
 * — that one is reused from #1337 and is not what this slice adds.
 */

import { describe, expect, it } from "vitest";

import {
  assertLookbookPinnable,
  slotToVariantIndex,
} from "@/lib/lookbook-variant";

describe("slotToVariantIndex (issue #1340)", () => {
  it('maps "A" to 0', () => {
    expect(slotToVariantIndex("A")).toBe(0);
  });

  it('maps "B" to 1', () => {
    expect(slotToVariantIndex("B")).toBe(1);
  });

  it('maps "original" to null (lookbook cannot pin to source photo)', () => {
    expect(slotToVariantIndex("original")).toBeNull();
  });
});

describe("assertLookbookPinnable (issue #1340)", () => {
  it("accepts 'A'", () => {
    expect(() => assertLookbookPinnable("A")).not.toThrow();
  });

  it("accepts 'B'", () => {
    expect(() => assertLookbookPinnable("B")).not.toThrow();
  });

  it("rejects 'original' with the design's intent in the message", () => {
    expect(() => assertLookbookPinnable("original")).toThrow(
      /only "A" or "B" are pinnable/
    );
  });
});
