import { describe, expect, it } from "vitest";

import { inpaintSubmitSchema } from "@/lib/inpaint-submit";
import {
  ARRANGEMENT_VARIATION_DIRECTIVE,
  TRY_ANOTHER_LAYOUT_LABEL,
  TRY_ANOTHER_LAYOUT_NUDGE_MAX,
  buildTryAnotherLayoutDirectives,
  formatTryAnotherLayoutNudge,
} from "@/lib/try-another-layout";
import { buildHolisticDirectives } from "@/lib/holistic-prompt";

describe("TRY_ANOTHER_LAYOUT_LABEL", () => {
  it("is a short button label that mentions 'layout'", () => {
    expect(TRY_ANOTHER_LAYOUT_LABEL.toLowerCase()).toContain("layout");
    expect(TRY_ANOTHER_LAYOUT_LABEL.length).toBeGreaterThan(0);
  });
});

describe("formatTryAnotherLayoutNudge", () => {
  it("returns null for empty or whitespace-only input", () => {
    expect(formatTryAnotherLayoutNudge("")).toBeNull();
    expect(formatTryAnotherLayoutNudge("   \n\t  ")).toBeNull();
  });

  it("wraps a short nudge in the User nudge label sentence", () => {
    expect(formatTryAnotherLayoutNudge("keep the sofa facing the fireplace")).toBe(
      "User nudge for the layout: keep the sofa facing the fireplace."
    );
  });

  it("trims whitespace before wrapping", () => {
    expect(formatTryAnotherLayoutNudge("  clear the path to the deck  ")).toBe(
      "User nudge for the layout: clear the path to the deck."
    );
  });

  it("caps the nudge length and marks truncation with an ellipsis", () => {
    const long = "x".repeat(TRY_ANOTHER_LAYOUT_NUDGE_MAX + 50);
    const formatted = formatTryAnotherLayoutNudge(long);
    expect(formatted).not.toBeNull();
    // The wrapped string is "User nudge for the layout: …" so the user's
    // payload (clipped at the cap) sits inside that label, not over it.
    // Result = "User nudge for the layout: " (26) + clipped user content
    // (≤ TRY_ANOTHER_LAYOUT_NUDGE_MAX) + ellipsis "…" (1) + sentence period
    // "." (1). Allowing +2 over the prefix+cap bound keeps the assertion
    // robust against punctuation wrapping without silently relaxing the cap.
    expect(formatted!.length).toBeLessThanOrEqual(
      "User nudge for the layout: ".length + TRY_ANOTHER_LAYOUT_NUDGE_MAX + 2
    );
    expect(formatted!.endsWith("…")).toBe(true);
  });
});

describe("buildTryAnotherLayoutDirectives", () => {
  const aesthetic = "Modern Farmhouse";

  it("preserves the architecture-first wording from buildHolisticDirectives", () => {
    const directives = buildTryAnotherLayoutDirectives({ aesthetic });
    const baseline = buildHolisticDirectives({
      aesthetic,
      variant: "architecture-first",
    });
    // Issue #1187 § Architecture preservation: the whole
    // architecture-preservation paragraph must carry over verbatim so the
    // two surfaces cannot drift on the constraint that matters.
    expect(directives).toContain(baseline);
  });

  it("appends the arrangement-variation language with the aesthetic interpolated", () => {
    const directives = buildTryAnotherLayoutDirectives({ aesthetic });
    expect(directives).toContain(ARRANGEMENT_VARIATION_DIRECTIVE.replace("{aesthetic}", aesthetic));
  });

  it("reuses 'same room, only restaged' lineage from issue #223", () => {
    const directives = buildTryAnotherLayoutDirectives({ aesthetic: "Japandi" });
    expect(directives).toContain("same room, only restaged");
  });

  it("treats empty nudge as absent", () => {
    const empty = buildTryAnotherLayoutDirectives({ aesthetic, nudge: "" });
    const omitted = buildTryAnotherLayoutDirectives({ aesthetic });
    expect(empty).toBe(omitted);
    expect(empty).not.toContain("User nudge for the layout");
  });

  it("appends a formatted nudge when one is provided", () => {
    const directives = buildTryAnotherLayoutDirectives({
      aesthetic,
      nudge: "keep the sofa facing the fireplace",
    });
    expect(directives).toContain(
      "User nudge for the layout: keep the sofa facing the fireplace."
    );
  });

  it("produces schema-valid promptDirectives for a max-length aesthetic", () => {
    const maxAesthetic = "x".repeat(200);
    const nudge = "nudge ".repeat(40).trim();
    const directives = buildTryAnotherLayoutDirectives({
      aesthetic: maxAesthetic,
      nudge,
    });
    expect(directives.length).toBeGreaterThanOrEqual(1);
    expect(directives.length).toBeLessThanOrEqual(2000);
  });

  it("parses against the inpaint route schema (with the negative prompt override)", () => {
    const directives = buildTryAnotherLayoutDirectives({
      aesthetic,
      nudge: "free the doorway",
    });
    const parsed = inpaintSubmitSchema.safeParse({
      imageUrl: "https://room.supabase.co/storage/v1/object/public/before.jpg",
      maskUrl: "data:image/png;base64,AAAA",
      promptDirectives: directives,
      negativePrompt:
        "walls, windows, trim, doors, molding, structural columns, flooring",
      aesthetic,
      roomId: "room_x",
      variantSlot: 0,
      sourceSlot: 0,
    });
    expect(parsed.success).toBe(true);
  });
});
