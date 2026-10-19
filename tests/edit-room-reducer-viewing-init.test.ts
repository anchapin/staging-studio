/**
 * Issue #1380 — `createInitialEditRoomState` must sync `viewing` to the
 * `initialLookbookSlot` the parent route resolved, so the studio's first
 * render carries the correct `data-viewing` attribute.
 *
 * The failing e2e assertion lives in
 * `tests/e2e/specs/edit-room-redesign-version-strip.spec.ts` test #6
 * (`expect(studio).toHaveAttribute("data-viewing", "A")` immediately
 * after `openFocusedEditor` on the seeded Mask Room project, where
 * `selectedVariantIndex === 0` resolves to `initialLookbookSlot === "A"`).
 *
 * The coercion rule is: if no explicit `viewing` override AND the
 * supplied `lookbookSlot` is a variant slot, mirror it into `viewing`;
 * otherwise leave `viewing` at its canned default. Manual override via
 * the inspector CTA keeps working because the shell dispatches
 * `SET_VIEWING` post-boot.
 */

import { describe, expect, it } from "vitest";

import {
  createInitialEditRoomState,
  initialEditRoomState,
} from "@/components/edit-room/edit-room-reducer";

describe("createInitialEditRoomState — #1380 viewing sync", () => {
  it("returns the canned default unchanged when called with no args", () => {
    // Backwards-compat: every existing call site that still passes
    // nothing must keep getting viewing = "original".
    expect(createInitialEditRoomState()).toEqual(initialEditRoomState);
    expect(createInitialEditRoomState().viewing).toBe("original");
  });

  it('coerces viewing to "A" when lookbookSlot resolves to "A"', () => {
    // The seeded Mask Room path the e2e spec exercises.
    const state = createInitialEditRoomState({ lookbookSlot: "A" });
    expect(state.viewing).toBe("A");
    expect(state.lookbookSlot).toBe("A");
  });

  it('coerces viewing to "B" when lookbookSlot resolves to "B"', () => {
    const state = createInitialEditRoomState({ lookbookSlot: "B" });
    expect(state.viewing).toBe("B");
  });

  it('leaves viewing at "original" when lookbookSlot is "original"', () => {
    // Conservative: only coerce when we know we are on a real variant.
    // resolveInitialLookbookSlot returns "A" | "B" only — this case is
    // defensive symmetry for any future call site that passes a
    // different shape.
    const state = createInitialEditRoomState({ lookbookSlot: "original" });
    expect(state.viewing).toBe("original");
  });

  it("an explicit viewing override always wins over the slot coercion", () => {
    // The shell never does this today, but the contract is part of the
    // Partial<EditRoomState> API and must hold: a caller who already
    // knows what they want (initialDirections-style seed) overrides
    // the default; the lookbook-slot coercion is only a fallback.
    const state = createInitialEditRoomState({
      lookbookSlot: "A",
      viewing: "original",
    });
    expect(state.viewing).toBe("original");
  });
});
