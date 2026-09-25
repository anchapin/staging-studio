import { describe, expect, it } from "vitest";

import {
  armForCurrentBase,
  initialSegmentRefreshState,
  isSegmentDetectionArmed,
  markCompletionRebase,
  markUserSourceNavigation,
  resolveBaseImageChange,
  type SegmentRefreshState,
} from "@/lib/segment-refresh-policy";

/**
 * Issue #748: refresh detection is LAZY — a post-completion rebase of the
 * editor onto the staged result must never authorize (bill) a SAM call;
 * only an explicit user action re-arms the current base. Editor open and
 * user-driven source switches stay armed (#202/#228 lifecycle).
 */

const BEFORE = "https://storage/rooms/r1/before-image.png";
const STAGED = "https://storage/staged-results/s1.png";

describe("initialSegmentRefreshState", () => {
  it("arms the mount base (issue #228 editor-open auto-fire)", () => {
    const state = initialSegmentRefreshState(BEFORE);
    expect(state.armedUrl).toBe(BEFORE);
    expect(isSegmentDetectionArmed(state, BEFORE)).toBe(true);
  });

  it("stays disarmed for an empty base", () => {
    const state = initialSegmentRefreshState("");
    expect(state.armedUrl).toBeNull();
    expect(isSegmentDetectionArmed(state, "")).toBe(false);
  });
});

describe("resolveBaseImageChange", () => {
  it("reports armed with no state change for the already-armed base (idempotent)", () => {
    const state = initialSegmentRefreshState(BEFORE);
    const outcome = resolveBaseImageChange(state, BEFORE);
    expect(outcome.nextState).toBeNull();
    expect(outcome.status).toBe("armed");
    expect(outcome.resetStaleDetection).toBe(false);
  });

  it("lands a completion rebase LAZY — no billed refresh, stale state reset", () => {
    // The run completed while BEFORE was displayed: the rebase mark keeps
    // BEFORE armed until the parent actually swaps the prop.
    const marked = markCompletionRebase(initialSegmentRefreshState(BEFORE));
    expect(isSegmentDetectionArmed(marked, BEFORE)).toBe(true);

    const outcome = resolveBaseImageChange(marked, STAGED);
    expect(outcome.status).toBe("lazy");
    expect(outcome.resetStaleDetection).toBe(true);
    expect(outcome.nextState).toEqual({
      armedUrl: null,
      pendingUserNavigation: false,
      pendingCompletionRebase: false,
    });
    expect(isSegmentDetectionArmed(outcome.nextState!, STAGED)).toBe(false);
  });

  it("applies a completion rebase even when the staged URL is unchanged", () => {
    // A batch restage can persist the SAME staged URL for consecutive
    // objects — the state change alone (not the URL change) carries the
    // rebase, so the second completion must still land lazy.
    const armedStaged = armForCurrentBase(initialSegmentRefreshState(STAGED), STAGED);
    const marked = markCompletionRebase(armedStaged);
    const outcome = resolveBaseImageChange(marked, STAGED);
    expect(outcome.status).toBe("lazy");
    expect(outcome.resetStaleDetection).toBe(true);
    expect(outcome.nextState?.armedUrl).toBeNull();
  });

  it("arms the next base after a USER source navigation (#202/#228)", () => {
    const marked = markUserSourceNavigation(initialSegmentRefreshState(BEFORE));
    const outcome = resolveBaseImageChange(marked, STAGED);
    expect(outcome.status).toBe("armed");
    expect(outcome.resetStaleDetection).toBe(false);
    expect(outcome.nextState).toEqual({
      armedUrl: STAGED,
      pendingUserNavigation: false,
      pendingCompletionRebase: false,
    });
  });

  it("treats an unmarked parent-driven base change as lazy (defensive — never bill it)", () => {
    const outcome = resolveBaseImageChange(initialSegmentRefreshState(BEFORE), STAGED);
    expect(outcome.status).toBe("lazy");
    expect(outcome.resetStaleDetection).toBe(true);
    expect(outcome.nextState).toBeNull();
  });

  it("is idempotent: re-resolving a consumed transition changes nothing", () => {
    const lazy: SegmentRefreshState = {
      armedUrl: null,
      pendingUserNavigation: false,
      pendingCompletionRebase: false,
    };
    const again = resolveBaseImageChange(lazy, STAGED);
    expect(again.nextState).toBeNull();
    expect(again.status).toBe("lazy");
    expect(again.resetStaleDetection).toBe(true); // stays true, state untouched
  });

  it("ignores an empty base (nothing to authorize or reset)", () => {
    const outcome = resolveBaseImageChange(initialSegmentRefreshState(BEFORE), "");
    expect(outcome.nextState).toBeNull();
    expect(outcome.resetStaleDetection).toBe(false);
  });
});

describe("markUserSourceNavigation vs markCompletionRebase", () => {
  it("an explicit navigation supersedes a pending completion rebase", () => {
    // User clicks the source selector while a completion persist is in
    // flight: the navigation is the later, explicit signal — arm next.
    const state = markUserSourceNavigation(
      markCompletionRebase(initialSegmentRefreshState(BEFORE))
    );
    const outcome = resolveBaseImageChange(state, STAGED);
    expect(outcome.status).toBe("armed");
  });

  it("a completion supersedes a pending user navigation", () => {
    // Navigation flagged but no URL change landed before the run finished:
    // the rebase that actually arrives is the completion's — land lazy.
    const state = markCompletionRebase(
      markUserSourceNavigation(initialSegmentRefreshState(BEFORE))
    );
    const outcome = resolveBaseImageChange(state, STAGED);
    expect(outcome.status).toBe("lazy");
    expect(outcome.resetStaleDetection).toBe(true);
  });
});

describe("armForCurrentBase", () => {
  it("arms a lazy base (the explicit refresh)", () => {
    const lazy = resolveBaseImageChange(
      markCompletionRebase(initialSegmentRefreshState(BEFORE)),
      STAGED
    ).nextState!;
    const armed = armForCurrentBase(lazy, STAGED);
    expect(isSegmentDetectionArmed(armed, STAGED)).toBe(true);
    // Resolving after arming stays armed with nothing to reset.
    const outcome = resolveBaseImageChange(armed, STAGED);
    expect(outcome.status).toBe("armed");
    expect(outcome.resetStaleDetection).toBe(false);
  });

  it("is a no-op for an already-armed base (same object identity)", () => {
    const state = initialSegmentRefreshState(BEFORE);
    expect(armForCurrentBase(state, BEFORE)).toBe(state);
  });

  it("ignores arming with no image", () => {
    const state = initialSegmentRefreshState(BEFORE);
    expect(armForCurrentBase(state, "")).toBe(state);
  });

  it("arming keeps a pending completion rebase intact (the rebase still lands lazy)", () => {
    // User grabs the refresh affordance while the completion persist is
    // still in flight: the CURRENT base arms, but the incoming staged
    // base must still land lazy.
    const state = armForCurrentBase(
      markCompletionRebase(initialSegmentRefreshState(BEFORE)),
      BEFORE
    );
    const outcome = resolveBaseImageChange(state, STAGED);
    expect(outcome.status).toBe("lazy");
    expect(outcome.resetStaleDetection).toBe(true);
  });
});

describe("isSegmentDetectionArmed", () => {
  it("is false for a null armedUrl, an empty image, or a mismatch", () => {
    expect(isSegmentDetectionArmed({ armedUrl: null, pendingUserNavigation: false, pendingCompletionRebase: false }, STAGED)).toBe(false);
    expect(isSegmentDetectionArmed({ armedUrl: BEFORE, pendingUserNavigation: false, pendingCompletionRebase: false }, "")).toBe(false);
    expect(isSegmentDetectionArmed({ armedUrl: BEFORE, pendingUserNavigation: false, pendingCompletionRebase: false }, STAGED)).toBe(false);
  });
});
