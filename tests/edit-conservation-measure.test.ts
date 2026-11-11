/**
 * Unit tests for `measureSceneConservation` (issue #1513).
 *
 * The measurement layer lives in `src/lib/edit-conservation-measure.ts`
 * and is browser-only glue (Image / canvas). Its pure sample-size math
 * was extracted into `src/lib/edit-conservation-geometry.ts` and is
 * pinned there (`tests/edit-conservation-geometry.test.ts`).
 *
 * What this file pins is the FAILURE POLICY of the measurement layer:
 * in a non-browser environment nothing can be measured, so the function
 * must resolve to `null` — the caller's explicit "not measured" no-op —
 * instead of throwing or inventing a measurement. The gate then reports
 * no warnings.
 */
import { describe, expect, it } from "vitest";
import {
  measureSceneConservation,
  CONSERVATION_SAMPLE_WIDTH,
  CONSERVATION_MAX_SAMPLE_HEIGHT,
} from "@/lib/edit-conservation-measure";

describe("measureSceneConservation", () => {
  it("resolves null for empty urls", async () => {
    await expect(
      measureSceneConservation({ referenceUrl: "", candidateUrl: "" }),
    ).resolves.toBeNull();
  });

  it("resolves null when there is no browser window to measure in", async () => {
    // The vitest environment for this file is `node` — there is no
    // `window`/`document`, so the images can never be decoded.
    expect(typeof window).toBe("undefined");
    await expect(
      measureSceneConservation({
        referenceUrl: "https://example.com/reference.png",
        candidateUrl: "https://example.com/candidate.png",
      }),
    ).resolves.toBeNull();
  });

  it("resolves null when only one of the two urls is present", async () => {
    await expect(
      measureSceneConservation({
        referenceUrl: "https://example.com/reference.png",
        candidateUrl: "",
      }),
    ).resolves.toBeNull();
    await expect(
      measureSceneConservation({
        referenceUrl: "",
        candidateUrl: "https://example.com/candidate.png",
      }),
    ).resolves.toBeNull();
  });

  it("re-exports the sample-size constants unchanged", () => {
    // The constants moved to the pure geometry module; the measurement
    // module keeps re-exporting them so existing imports do not break.
    expect(CONSERVATION_SAMPLE_WIDTH).toBe(256);
    expect(CONSERVATION_MAX_SAMPLE_HEIGHT).toBe(1024);
  });
});
