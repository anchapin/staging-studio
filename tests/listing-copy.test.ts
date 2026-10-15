/**
 * Issue #1343 — `resolveListingCopy` (lookbook page fallback resolver).
 *
 * The lookbook page (`/projects/[id]/lookbook`) and the print preview
 * (`/preview/[id]`) render the room's listing copy from the new
 * `lookbookHeadline` / `lookbookBody` columns when they are present,
 * and from the legacy `recommendation` field (the consultation-copy
 * "Our Approach" pillar) when the new columns are null. The fallback
 * shape mirrors the pillars render so unpinned rooms still show a
 * lookbook-grade narrative without an explicit magic-patterns round.
 *
 * Contract pinned by these tests:
 *  - Empty string and `null` are both treated as "not set" (a room
 *    that has never been opened in the new CopyPanel and a room
 *    where the user explicitly cleared the field both render the
 *    legacy fallback).
 *  - Whitespace-only strings are treated as "not set" so a copy-paste
 *    of pure whitespace doesn't hide the legacy copy.
 *  - When `lookbookHeadline` is set, it wins over any legacy field.
 *  - When `lookbookBody` is set, it wins over `recommendation`.
 *  - The resolver never throws on missing fields (the DB select is
 *    nullable throughout).
 */

import { describe, expect, it } from "vitest";

import { resolveListingCopy } from "@/lib/listing-copy";

describe("resolveListingCopy (issue #1343)", () => {
  it("returns the legacy fallback when no new fields are present", () => {
    const result = resolveListingCopy({
      lookbookHeadline: null,
      lookbookBody: null,
      recommendation: "Layer warm lamps and lighten textiles.",
    });
    expect(result.headline).toBeNull();
    expect(result.body).toBe("Layer warm lamps and lighten textiles.");
  });

  it("treats empty string and whitespace-only as 'not set' (renders legacy fallback)", () => {
    const r1 = resolveListingCopy({
      lookbookHeadline: "",
      lookbookBody: "",
      recommendation: "Layer warm lamps.",
    });
    expect(r1.headline).toBeNull();
    expect(r1.body).toBe("Layer warm lamps.");

    const r2 = resolveListingCopy({
      lookbookHeadline: "   ",
      lookbookBody: "\n\n",
      recommendation: "Layer warm lamps.",
    });
    expect(r2.headline).toBeNull();
    expect(r2.body).toBe("Layer warm lamps.");
  });

  it("uses the new headline when present (legacy recommendation is ignored for the body slot)", () => {
    const result = resolveListingCopy({
      lookbookHeadline: "Bright & Airy Living Room",
      lookbookBody: null,
      recommendation: "Layer warm lamps and lighten textiles.",
    });
    expect(result.headline).toBe("Bright & Airy Living Room");
    expect(result.body).toBe("Layer warm lamps and lighten textiles.");
  });

  it("uses the new body when present (overrides legacy recommendation)", () => {
    const result = resolveListingCopy({
      lookbookHeadline: "Bright & Airy Living Room",
      lookbookBody: "Light pours through south-facing windows.",
      recommendation: "Layer warm lamps and lighten textiles.",
    });
    expect(result.headline).toBe("Bright & Airy Living Room");
    expect(result.body).toBe("Light pours through south-facing windows.");
  });

  it("renders nothing (nulls both sides) when no source has any copy", () => {
    const result = resolveListingCopy({
      lookbookHeadline: null,
      lookbookBody: null,
      recommendation: null,
    });
    expect(result.headline).toBeNull();
    expect(result.body).toBeNull();
  });

  it("preserves whitespace inside the new body verbatim when it carries content (a leading newline is render-grade)", () => {
    const result = resolveListingCopy({
      lookbookHeadline: "H",
      lookbookBody: "  Trimmed-aware copy  ",
      recommendation: "Legacy",
    });
    // The resolver trims for the null-or-not decision, but once set,
    // it preserves the body verbatim so the lookbook render sees
    // exactly what was typed.
    expect(result.body).toBe("  Trimmed-aware copy  ");
  });

  it("is pure — same inputs always produce structurally equal output", () => {
    const inputs = {
      lookbookHeadline: "H" as string | null,
      lookbookBody: "B" as string | null,
      recommendation: "R" as string | null,
    };
    const a = resolveListingCopy(inputs);
    const b = resolveListingCopy(inputs);
    expect(a).toEqual(b);
  });
});
