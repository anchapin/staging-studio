/**
 * Issue #1342 — `resolveRunLabel` (primary Run button text).
 *
 * The Inspector's Run button shows one of three labels depending on the
 * (scope, selectedCount) tuple, plus a "Working… NN%" suffix when a
 * run is in flight. Pin every combination.
 *
 *  - whole-room + idle    → "Stage whole room"
 *  - whole-room + running → "Working… NN%"
 *  - objects + 0 + idle   → "Restage 0 objects"   (label still resolves; the
 *                                          button is disabled by the blocked
 *                                          resolver — but the label function
 *                                          is dumb on purpose)
 *  - objects + 1 + idle   → "Restage 1 object"
 *  - objects + N + idle   → "Restage N objects"  (N > 1)
 *  - objects + N + running → "Working… NN%"
 *  - paint + idle         → "Restage painted area"
 *  - paint + running      → "Working… NN%"
 *
 * `viewing` is part of the input shape for forward-compat with #1344's
 * per-variant variant text (the helper-text resolver already cares; the
 * label doesn't need it today but the signature mirrors the issue body).
 */

import { describe, expect, it } from "vitest";

import { resolveRunLabel } from "@/lib/edit-room-run-label";

describe("resolveRunLabel (issue #1342)", () => {
  it("returns 'Stage whole room' for scope=whole-room, not running", () => {
    expect(
      resolveRunLabel({
        scope: "whole-room",
        selectedCount: 0,
        viewing: "original",
        isRunning: false,
      })
    ).toEqual({ label: "Stage whole room", isLoading: false });
  });

  it("returns 'Working… NN%' when whole-room is running", () => {
    expect(
      resolveRunLabel({
        scope: "whole-room",
        selectedCount: 0,
        viewing: "original",
        isRunning: true,
        progress: 42,
      })
    ).toEqual({ label: "Working… 42%", isLoading: true });
  });

  it("uses 'Restage 1 object' (singular) when exactly one object is selected", () => {
    expect(
      resolveRunLabel({
        scope: "objects",
        selectedCount: 1,
        viewing: "A",
        isRunning: false,
      })
    ).toEqual({ label: "Restage 1 object", isLoading: false });
  });

  it("uses 'Restage N objects' (plural) for selectedCount > 1", () => {
    expect(
      resolveRunLabel({
        scope: "objects",
        selectedCount: 3,
        viewing: "A",
        isRunning: false,
      })
    ).toEqual({ label: "Restage 3 objects", isLoading: false });
  });

  it("uses 'Restage 0 objects' when objects scope runs with no selection (button is blocked)", () => {
    // The blocked resolver disables the button at selectedCount=0, but
    // resolveRunLabel is intentionally dumb — it still produces a string
    // so the call site never has to branch on "is this disabled?".
    expect(
      resolveRunLabel({
        scope: "objects",
        selectedCount: 0,
        viewing: "A",
        isRunning: false,
      })
    ).toEqual({ label: "Restage 0 objects", isLoading: false });
  });

  it("returns 'Working… NN%' when objects scope is running", () => {
    expect(
      resolveRunLabel({
        scope: "objects",
        selectedCount: 2,
        viewing: "A",
        isRunning: true,
        progress: 80,
      })
    ).toEqual({ label: "Working… 80%", isLoading: true });
  });

  it("returns 'Restage painted area' for scope=paint, not running", () => {
    expect(
      resolveRunLabel({
        scope: "paint",
        selectedCount: 0,
        viewing: "A",
        isRunning: false,
      })
    ).toEqual({ label: "Restage painted area", isLoading: false });
  });

  it("returns 'Working… NN%' when paint scope is running", () => {
    expect(
      resolveRunLabel({
        scope: "paint",
        selectedCount: 0,
        viewing: "A",
        isRunning: true,
        progress: 17,
      })
    ).toEqual({ label: "Working… 17%", isLoading: true });
  });

  it("treats progress=0 as 'Working… 0%' (ramp from zero is part of the run)", () => {
    expect(
      resolveRunLabel({
        scope: "whole-room",
        selectedCount: 0,
        viewing: "original",
        isRunning: true,
        progress: 0,
      })
    ).toEqual({ label: "Working… 0%", isLoading: true });
  });

  it("defaults progress to 0 when not provided + isRunning=true", () => {
    expect(
      resolveRunLabel({
        scope: "objects",
        selectedCount: 1,
        viewing: "A",
        isRunning: true,
      })
    ).toEqual({ label: "Working… 0%", isLoading: true });
  });
});