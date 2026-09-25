import { describe, expect, it } from "vitest";

import {
  getActiveVariant,
  setActiveVariant,
  cloneVariant,
  resolveSlotFromIndex,
  isCompleteVariant,
  type VariantRoom,
} from "@/lib/room-variant-service";
import type { VariantSlot } from "@/lib/inpaint-source";

const makeRoom = (overrides: Partial<VariantRoom> = {}): VariantRoom => ({
  afterImageUrl: null,
  afterImageUrl2: null,
  beforeImageUrl: null,
  beforeImageUrl2: null,
  selectedVariantIndex: null,
  ...overrides,
});

describe("getActiveVariant", () => {
  it("returns null when selectedVariantIndex is null", () => {
    const room = makeRoom({ selectedVariantIndex: null });
    expect(getActiveVariant(room)).toBeNull();
  });

  it("returns null when selectedVariantIndex is 0 but afterImageUrl is null", () => {
    const room = makeRoom({ selectedVariantIndex: 0, afterImageUrl: null });
    expect(getActiveVariant(room)).toBeNull();
  });

  it("returns null when selectedVariantIndex is 1 but afterImageUrl2 is null", () => {
    const room = makeRoom({ selectedVariantIndex: 1, afterImageUrl2: null });
    expect(getActiveVariant(room)).toBeNull();
  });

  it("returns correct slot and url for selected variant A (index 0)", () => {
    const room = makeRoom({
      selectedVariantIndex: 0,
      afterImageUrl: "https://example.com/variant-a.png",
    });
    expect(getActiveVariant(room)).toEqual({
      slot: 0,
      afterImageUrl: "https://example.com/variant-a.png",
    });
  });

  it("returns correct slot and url for selected variant B (index 1)", () => {
    const room = makeRoom({
      selectedVariantIndex: 1,
      afterImageUrl2: "https://example.com/variant-b.png",
    });
    expect(getActiveVariant(room)).toEqual({
      slot: 1,
      afterImageUrl: "https://example.com/variant-b.png",
    });
  });
});

describe("setActiveVariant", () => {
  it("accepts 0 as valid index", () => {
    const room = makeRoom();
    expect(setActiveVariant(room, 0)).toBe(0);
  });

  it("accepts 1 as valid index", () => {
    const room = makeRoom();
    expect(setActiveVariant(room, 1)).toBe(1);
  });

  it("accepts null as valid index", () => {
    const room = makeRoom();
    expect(setActiveVariant(room, null)).toBeNull();
  });

  it("rejects negative numbers", () => {
    const room = makeRoom();
    expect(setActiveVariant(room, -1)).toBeNull();
  });

  it("rejects numbers greater than 1", () => {
    const room = makeRoom();
    expect(setActiveVariant(room, 2)).toBeNull();
  });

  it("rejects non-integer numbers", () => {
    const room = makeRoom();
    expect(setActiveVariant(room, 0.5 as unknown as number)).toBeNull();
  });
});

describe("cloneVariant", () => {
  it("returns null when no variant is selected", () => {
    const room = makeRoom({ selectedVariantIndex: null });
    expect(cloneVariant(room)).toBeNull();
  });

  it("returns null when selected variant has no after image", () => {
    const room = makeRoom({ selectedVariantIndex: 0, afterImageUrl: null });
    expect(cloneVariant(room)).toBeNull();
  });

  it("returns correct clone data for variant A", () => {
    const room = makeRoom({
      selectedVariantIndex: 0,
      afterImageUrl: "https://example.com/variant-a.png",
    });
    expect(cloneVariant(room)).toEqual({
      afterImageUrl: "https://example.com/variant-a.png",
      selectedVariantIndex: 0,
    });
  });

  it("returns correct clone data for variant B", () => {
    const room = makeRoom({
      selectedVariantIndex: 1,
      afterImageUrl2: "https://example.com/variant-b.png",
    });
    expect(cloneVariant(room)).toEqual({
      afterImageUrl: "https://example.com/variant-b.png",
      selectedVariantIndex: 1,
    });
  });
});

describe("resolveSlotFromIndex", () => {
  it("returns 'original' for null", () => {
    expect(resolveSlotFromIndex(null)).toBe("original");
  });

  it("returns 'variantA' for 0", () => {
    expect(resolveSlotFromIndex(0)).toBe("variantA");
  });

  it("returns 'variantB' for 1", () => {
    expect(resolveSlotFromIndex(1)).toBe("variantB");
  });
});

describe("isCompleteVariant", () => {
  it("returns true when slot 0 has afterImageUrl", () => {
    const room = makeRoom({ afterImageUrl: "https://example.com/a.png" });
    expect(isCompleteVariant(room, 0 as VariantSlot)).toBe(true);
  });

  it("returns false when slot 0 has null afterImageUrl", () => {
    const room = makeRoom({ afterImageUrl: null });
    expect(isCompleteVariant(room, 0 as VariantSlot)).toBe(false);
  });

  it("returns true when slot 1 has afterImageUrl2", () => {
    const room = makeRoom({ afterImageUrl2: "https://example.com/b.png" });
    expect(isCompleteVariant(room, 1 as VariantSlot)).toBe(true);
  });

  it("returns false when slot 1 has null afterImageUrl2", () => {
    const room = makeRoom({ afterImageUrl2: null });
    expect(isCompleteVariant(room, 1 as VariantSlot)).toBe(false);
  });
});
