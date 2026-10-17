/**
 * Issue #1342 — `resolveHelperText` (Inspector footer subline).
 *
 * The Inspector renders a 12px ink-subtle line under the Run button.
 * Three branches, in priority order:
 *  1. When the blocked resolver returns a string → show that string.
 *     (The button is disabled, so the helper text doubles as the
 *     "why is this disabled" affordance.)
 *  2. Otherwise, when `viewing === "original"` → "Result saves as
 *     Variant <targetSlot>". The next run lands on the first empty
 *     variant slot (per `resolveTargetSlot`).
 *  3. Otherwise (viewing is a variant) → "Touches up Variant <viewing>
 *     in place". The run is a touch-up on the visible variant.
 *
 * Pinned by every branch in the table above (one test per branch +
 * edge cases for the "blocked reason takes priority over targetSlot
 * shape" case).
 */

import { describe, expect, it } from "vitest";

import { resolveHelperText } from "@/lib/edit-room-helper-text";

describe("resolveHelperText (issue #1342)", () => {
  it("returns the blocked reason verbatim when blockedReason is a non-empty string", () => {
    expect(
      resolveHelperText({
        viewing: "original",
        targetSlot: "A",
        blockedReason: "Add directions so the AI knows what to stage.",
      })
    ).toBe("Add directions so the AI knows what to stage.");
  });

  it("returns the blocked reason even when targetSlot is a variant (blocked beats everything)", () => {
    expect(
      resolveHelperText({
        viewing: "A",
        targetSlot: "A",
        blockedReason: "Pick at least one object on the photo.",
      })
    ).toBe("Pick at least one object on the photo.");
  });

  it('returns "Result saves as Variant <slot>" when viewing=original', () => {
    expect(
      resolveHelperText({ viewing: "original", targetSlot: "A", blockedReason: null })
    ).toBe("Result saves as Variant A");
  });

  it('returns "Result saves as Variant B" when original viewing + both A and B exist', () => {
    // resolveTargetSlot's last-resort fallback when both variants are
    // populated — the helper text just reflects whatever slot was chosen.
    expect(
      resolveHelperText({ viewing: "original", targetSlot: "B", blockedReason: null })
    ).toBe("Result saves as Variant B");
  });

  it('returns "Touches up Variant A in place" when viewing=variant A', () => {
    expect(
      resolveHelperText({ viewing: "A", targetSlot: "A", blockedReason: null })
    ).toBe("Touches up Variant A in place");
  });

  it('returns "Touches up Variant B in place" when viewing=variant B', () => {
    expect(
      resolveHelperText({ viewing: "B", targetSlot: "B", blockedReason: null })
    ).toBe("Touches up Variant B in place");
  });

  it("treats blockedReason=null and viewing=original + targetSlot=A as the success path", () => {
    expect(
      resolveHelperText({ viewing: "original", targetSlot: "A", blockedReason: null })
    ).toBe("Result saves as Variant A");
  });

  it("treats empty-string blockedReason as no block (returns the viewing-branch text)", () => {
    // Defense-in-depth: a falsy-but-non-null blockedReason should not
    // accidentally surface an empty helper. Only a non-empty string
    // is treated as a block.
    expect(
      resolveHelperText({ viewing: "original", targetSlot: "A", blockedReason: "" })
    ).toBe("Result saves as Variant A");
  });
});