/**
 * Issue #1343 — `autosaveCopy` (pure resolver for the Room listing copy).
 *
 * The CopyPanel calls `autosaveCopy(roomId, headline, body)` on every
 * debounced edit. The controller (`AutosaveController<T>`) is the one
 * that owns debounce + retry semantics; this module just owns the
 * Prisma-update payload shape and the field-length contract so the
 * validators can be pinned without spinning up React or Prisma.
 *
 * Contract pinned by these tests:
 *  - Returns a `Prisma.RoomUpdateInput`-shaped object: the two new
 *    fields (`lookbookHeadline`, `lookbookBody`).
 *  - Empty strings are allowed (the user can clear a field); the
 *    resolver still writes them so the lookbook render sees the
 *    "explicitly cleared" state distinct from "never touched".
 *  - Whitespace is preserved verbatim (so what the user typed is
 *    what lands in the DB; trimming is the lookbook render's job).
 *  - A non-empty payload and an empty payload produce identical
 *    shape (so swapping from "I just typed something" to "I cleared
 *    it" never surprises the controller).
 *  - The resolver is pure: same inputs always produce same output.
 */

import { describe, expect, it } from "vitest";

import { autosaveCopy } from "@/lib/autosave-copy";

describe("autosaveCopy (issue #1343)", () => {
  it("returns the two new Room fields (lookbookHeadline + lookbookBody) verbatim", () => {
    const update = autosaveCopy({
      headline: "A bright, airy living room with restored crown molding",
      body: "Light pours through the south-facing windows.",
    });
    expect(update.lookbookHeadline).toBe(
      "A bright, airy living room with restored crown molding"
    );
    expect(update.lookbookBody).toBe("Light pours through the south-facing windows.");
  });

  it("writes empty strings when the user clears a field (explicit clear ≠ untouched)", () => {
    const update = autosaveCopy({ headline: "", body: "" });
    expect(update.lookbookHeadline).toBe("");
    expect(update.lookbookBody).toBe("");
  });

  it("preserves whitespace verbatim — trimming is the renderer's job", () => {
    const update = autosaveCopy({
      headline: "  Spaced  headline  ",
      body: "\nNewline body\n",
    });
    expect(update.lookbookHeadline).toBe("  Spaced  headline  ");
    expect(update.lookbookBody).toBe("\nNewline body\n");
  });

  it("mixes empty and non-empty without surprising the controller (one field cleared, the other typed)", () => {
    const update = autosaveCopy({ headline: "Just a headline", body: "" });
    expect(update.lookbookHeadline).toBe("Just a headline");
    expect(update.lookbookBody).toBe("");
  });

  it("produces no extra keys — the Prisma write path only carries the two columns", () => {
    const update = autosaveCopy({ headline: "h", body: "b" });
    expect(Object.keys(update).sort()).toEqual(["lookbookBody", "lookbookHeadline"]);
  });

  it("is pure — same inputs always produce a structurally equal payload", () => {
    const inputs = { headline: "h", body: "b" };
    const a = autosaveCopy(inputs);
    const b = autosaveCopy(inputs);
    expect(a).toEqual(b);
  });
});
