/**
 * "Virtually staged" disclosure helpers (issue #1186) — pure-logic tests.
 *
 * Pinned behaviors:
 *   - Project toggle resolves null/undefined as enabled (conservative
 *     default), only an explicit `false` hides the mark.
 *   - After-image predicate requires BOTH before and after URLs (a
 *     complete variant pair).
 *   - Composite decision AND-combines the toggle and the predicate.
 *
 * Side effects: none — pure tests of pure helpers.
 */

import { describe, it, expect } from "vitest";
import {
  VIRTUALLY_STAGED_LABEL_TEXT,
  resolveVirtuallyStagedLabelEnabled,
  isAiStagedAfterImage,
  shouldRenderVirtuallyStagedBadge,
} from "../src/lib/virtually-staged-label";

describe("VIRTUALLY_STAGED_LABEL_TEXT", () => {
  it("is the literal disclosure string", () => {
    expect(VIRTUALLY_STAGED_LABEL_TEXT).toBe("Virtually Staged");
  });
});

describe("resolveVirtuallyStagedLabelEnabled", () => {
  it("treats null as enabled (the conservative default)", () => {
    expect(resolveVirtuallyStagedLabelEnabled(null)).toBe(true);
  });

  it("treats undefined as enabled", () => {
    expect(resolveVirtuallyStagedLabelEnabled(undefined)).toBe(true);
  });

  it("preserves an explicit true", () => {
    expect(resolveVirtuallyStagedLabelEnabled(true)).toBe(true);
  });

  it("honors an explicit false (the only way to disable)", () => {
    expect(resolveVirtuallyStagedLabelEnabled(false)).toBe(false);
  });
});

describe("isAiStagedAfterImage", () => {
  it("returns true when both before and after URLs are present", () => {
    expect(
      isAiStagedAfterImage("https://x/before.jpg", "https://x/after.jpg")
    ).toBe(true);
  });

  it("returns false when the after image is missing", () => {
    expect(isAiStagedAfterImage("https://x/before.jpg", null)).toBe(false);
    expect(isAiStagedAfterImage("https://x/before.jpg", undefined)).toBe(
      false
    );
    expect(isAiStagedAfterImage("https://x/before.jpg", "")).toBe(false);
  });

  it("returns false when the before image is missing", () => {
    expect(isAiStagedAfterImage(null, "https://x/after.jpg")).toBe(false);
    expect(isAiStagedAfterImage(undefined, "https://x/after.jpg")).toBe(
      false
    );
    expect(isAiStagedAfterImage("", "https://x/after.jpg")).toBe(false);
  });
});

describe("shouldRenderVirtuallyStagedBadge", () => {
  it("renders when the project is enabled and the variant pair is complete", () => {
    expect(
      shouldRenderVirtuallyStagedBadge({
        projectEnabled: true,
        beforeImageUrl: "https://x/before.jpg",
        afterImageUrl: "https://x/after.jpg",
      })
    ).toBe(true);
  });

  it("renders when the project toggle is null/undefined (default-on)", () => {
    expect(
      shouldRenderVirtuallyStagedBadge({
        projectEnabled: null,
        beforeImageUrl: "https://x/before.jpg",
        afterImageUrl: "https://x/after.jpg",
      })
    ).toBe(true);
    expect(
      shouldRenderVirtuallyStagedBadge({
        projectEnabled: undefined,
        beforeImageUrl: "https://x/before.jpg",
        afterImageUrl: "https://x/after.jpg",
      })
    ).toBe(true);
  });

  it("does not render when the project toggle is explicitly false", () => {
    expect(
      shouldRenderVirtuallyStagedBadge({
        projectEnabled: false,
        beforeImageUrl: "https://x/before.jpg",
        afterImageUrl: "https://x/after.jpg",
      })
    ).toBe(false);
  });

  it("does not render when the variant pair is incomplete (no after to mark)", () => {
    expect(
      shouldRenderVirtuallyStagedBadge({
        projectEnabled: true,
        beforeImageUrl: "https://x/before.jpg",
        afterImageUrl: null,
      })
    ).toBe(false);
    expect(
      shouldRenderVirtuallyStagedBadge({
        projectEnabled: true,
        beforeImageUrl: null,
        afterImageUrl: "https://x/after.jpg",
      })
    ).toBe(false);
  });
});