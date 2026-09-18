import { describe, expect, it } from "vitest";

import {
  buildInpaintResultPatch,
  healInpaintSource,
  inpaintSourceFromRequestRow,
  inpaintSourceLabel,
  inpaintSourcesEqual,
  listInpaintSources,
  pickVariantSlot,
  resolveInpaintSourceUrl,
  resolveInpaintTargetSlot,
  type InpaintSourceRoom,
} from "@/lib/inpaint-source";

const BEFORE = "https://img.supabase.co/storage/v1/object/public/staging-images/before.png";
const AFTER_0 = "https://img.supabase.co/storage/v1/object/public/staging-images/after-0.png";
const AFTER_1 = "https://img.supabase.co/storage/v1/object/public/staging-images/after-1.png";
const RESULT = "https://img.supabase.co/storage/v1/object/public/staging-images/result.png";

const ORIGINAL = { kind: "original" } as const;
const VARIANT_0 = { kind: "variant", slot: 0 } as const;
const VARIANT_1 = { kind: "variant", slot: 1 } as const;

function room(overrides: Partial<InpaintSourceRoom> = {}): InpaintSourceRoom {
  return {
    beforeImageUrl: BEFORE,
    afterImageUrl: null,
    afterImageUrl2: null,
    selectedVariantIndex: 0,
    ...overrides,
  };
}

describe("pickVariantSlot", () => {
  it("targets slot 0 when no after image exists", () => {
    expect(pickVariantSlot(room())).toBe(0);
  });

  it("targets slot 1 when only slot 0 is filled", () => {
    expect(pickVariantSlot(room({ afterImageUrl: AFTER_0 }))).toBe(1);
  });

  it("targets the non-selected slot when both are full", () => {
    const full = { afterImageUrl: AFTER_0, afterImageUrl2: AFTER_1 };
    expect(pickVariantSlot(room({ ...full, selectedVariantIndex: 0 }))).toBe(1);
    expect(pickVariantSlot(room({ ...full, selectedVariantIndex: 1 }))).toBe(0);
  });

  it("targets slot 1 when both are full and selection is null", () => {
    expect(
      pickVariantSlot(
        room({ afterImageUrl: AFTER_0, afterImageUrl2: AFTER_1, selectedVariantIndex: null })
      )
    ).toBe(1);
  });
});

describe("listInpaintSources", () => {
  it("always offers the original photo first", () => {
    expect(listInpaintSources(room())).toEqual([ORIGINAL]);
  });

  it("offers each variant with a completed staged result", () => {
    expect(listInpaintSources(room({ afterImageUrl: AFTER_0 }))).toEqual([
      ORIGINAL,
      VARIANT_0,
    ]);
    expect(
      listInpaintSources(room({ afterImageUrl: AFTER_0, afterImageUrl2: AFTER_1 }))
    ).toEqual([ORIGINAL, VARIANT_0, VARIANT_1]);
  });

  it("offers variant B alone when only slot 1 is filled", () => {
    expect(listInpaintSources(room({ afterImageUrl2: AFTER_1 }))).toEqual([
      ORIGINAL,
      VARIANT_1,
    ]);
  });
});

describe("inpaintSourceLabel", () => {
  it("labels the original and both variants", () => {
    expect(inpaintSourceLabel(ORIGINAL)).toBe("Original photo");
    expect(inpaintSourceLabel(VARIANT_0)).toBe("Variant A (staged)");
    expect(inpaintSourceLabel(VARIANT_1)).toBe("Variant B (staged)");
  });
});

describe("inpaintSourcesEqual", () => {
  it("distinguishes kinds and slots", () => {
    expect(inpaintSourcesEqual(ORIGINAL, ORIGINAL)).toBe(true);
    expect(inpaintSourcesEqual(VARIANT_0, VARIANT_0)).toBe(true);
    expect(inpaintSourcesEqual(ORIGINAL, VARIANT_0)).toBe(false);
    expect(inpaintSourcesEqual(VARIANT_0, VARIANT_1)).toBe(false);
  });
});

describe("resolveInpaintSourceUrl", () => {
  it("resolves the original source to the before photo", () => {
    expect(resolveInpaintSourceUrl(room(), ORIGINAL)).toBe(BEFORE);
  });

  it("resolves variant sources to that variant's after image", () => {
    const full = room({ afterImageUrl: AFTER_0, afterImageUrl2: AFTER_1 });
    expect(resolveInpaintSourceUrl(full, VARIANT_0)).toBe(AFTER_0);
    expect(resolveInpaintSourceUrl(full, VARIANT_1)).toBe(AFTER_1);
  });

  it("returns null when the source image is missing", () => {
    expect(resolveInpaintSourceUrl(room(), VARIANT_0)).toBeNull();
    expect(resolveInpaintSourceUrl(room({ beforeImageUrl: null }), ORIGINAL)).toBeNull();
  });
});

describe("resolveInpaintTargetSlot", () => {
  it("uses pickVariantSlot for original-source runs", () => {
    expect(resolveInpaintTargetSlot(room(), ORIGINAL)).toBe(0);
    expect(resolveInpaintTargetSlot(room({ afterImageUrl: AFTER_0 }), ORIGINAL)).toBe(1);
    const full = { afterImageUrl: AFTER_0, afterImageUrl2: AFTER_1 };
    expect(resolveInpaintTargetSlot(room(full), ORIGINAL)).toBe(1);
    expect(resolveInpaintTargetSlot(room({ ...full, selectedVariantIndex: 1 }), ORIGINAL)).toBe(0);
  });

  it("overwrites the source variant's own slot in place", () => {
    const full = room({ afterImageUrl: AFTER_0, afterImageUrl2: AFTER_1, selectedVariantIndex: 0 });
    expect(resolveInpaintTargetSlot(full, VARIANT_0)).toBe(0);
    expect(resolveInpaintTargetSlot(full, VARIANT_1)).toBe(1);
  });
});

describe("buildInpaintResultPatch", () => {
  it("writes slot 0 and selects variant A for a fresh run", () => {
    expect(buildInpaintResultPatch(room(), RESULT, ORIGINAL)).toEqual({
      afterImageUrl: RESULT,
      selectedVariantIndex: 0,
    });
  });

  it("mirrors the before photo into slot 1 and selects variant B for a fresh run", () => {
    expect(
      buildInpaintResultPatch(room({ afterImageUrl: AFTER_0 }), RESULT, ORIGINAL)
    ).toEqual({
      beforeImageUrl2: BEFORE,
      afterImageUrl2: RESULT,
      selectedVariantIndex: 1,
    });
  });

  it("omits the before mirror (never writes a null URL) if the before photo is missing", () => {
    expect(
      buildInpaintResultPatch(
        room({ beforeImageUrl: null, afterImageUrl: AFTER_0 }),
        RESULT,
        ORIGINAL
      )
    ).toEqual({
      afterImageUrl2: RESULT,
      selectedVariantIndex: 1,
    });
  });

  it("overwrites slot 0 in place without touching the selection", () => {
    const full = room({ afterImageUrl: AFTER_0, afterImageUrl2: AFTER_1, selectedVariantIndex: 0 });
    expect(buildInpaintResultPatch(full, RESULT, VARIANT_0)).toEqual({
      afterImageUrl: RESULT,
    });
  });

  it("overwrites slot 1 in place without touching the selection", () => {
    const full = room({ afterImageUrl: AFTER_0, afterImageUrl2: AFTER_1, selectedVariantIndex: 0 });
    expect(buildInpaintResultPatch(full, RESULT, VARIANT_1)).toEqual({
      afterImageUrl2: RESULT,
    });
  });

  it("leaves the selection untouched even when iterating on the selected variant", () => {
    const selectedIsB = room({
      afterImageUrl: AFTER_0,
      afterImageUrl2: AFTER_1,
      selectedVariantIndex: 1,
    });
    const patch = buildInpaintResultPatch(selectedIsB, RESULT, VARIANT_1);
    expect(patch.selectedVariantIndex).toBeUndefined();
    expect(patch.afterImageUrl2).toBe(RESULT);
  });
});

describe("healInpaintSource", () => {
  it("heals a stale variant source to the original photo when the variant's result is missing", () => {
    expect(healInpaintSource(room(), VARIANT_0)).toEqual(ORIGINAL);
  });

  it("heals a stale slot-1 variant source the same way", () => {
    expect(healInpaintSource(room({ afterImageUrl: AFTER_0 }), VARIANT_1)).toEqual(ORIGINAL);
  });

  it("passes a variant source with a live staged result through unchanged", () => {
    const full = room({ afterImageUrl: AFTER_0, afterImageUrl2: AFTER_1 });
    expect(healInpaintSource(full, VARIANT_0)).toEqual(VARIANT_0);
    expect(healInpaintSource(full, VARIANT_1)).toEqual(VARIANT_1);
  });

  it("passes the original photo source through unchanged", () => {
    expect(healInpaintSource(room(), ORIGINAL)).toEqual(ORIGINAL);
  });

  it("always heals to a source listInpaintSources offers for the same room", () => {
    const rooms: InpaintSourceRoom[] = [
      room(),
      room({ afterImageUrl: AFTER_0 }),
      room({ afterImageUrl2: AFTER_1 }),
      room({ afterImageUrl: AFTER_0, afterImageUrl2: AFTER_1 }),
    ];
    for (const current of rooms) {
      for (const source of [ORIGINAL, VARIANT_0, VARIANT_1]) {
        expect(
          listInpaintSources(current).some((option) =>
            inpaintSourcesEqual(option, healInpaintSource(current, source))
          )
        ).toBe(true);
      }
    }
  });
});

describe("inpaintSourceFromRequestRow", () => {
  it("maps stored source slots back to variant sources", () => {
    expect(inpaintSourceFromRequestRow({ sourceSlot: 0 })).toEqual(VARIANT_0);
    expect(inpaintSourceFromRequestRow({ sourceSlot: 1 })).toEqual(VARIANT_1);
  });

  it("treats null as an original-photo run (legacy rows)", () => {
    expect(inpaintSourceFromRequestRow({ sourceSlot: null })).toEqual(ORIGINAL);
  });

  it("treats unexpected values as an original-photo run", () => {
    expect(inpaintSourceFromRequestRow({ sourceSlot: 7 })).toEqual(ORIGINAL);
  });
});
