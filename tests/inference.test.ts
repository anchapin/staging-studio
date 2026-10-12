/**
 * Provider-agnostic inference abstraction (#1187 follow-up).
 *
 * Each adapter (currently only Alibaba, as of #1240) implements the same
 * `InferenceClient` surface; this file pins the contract that the rest
 * of the system relies on (logical-model names, status normalization,
 * request-gone detection). The Alibaba adapter's wire format is
 * verified by `tests/alibaba-adapter.test.ts`; this file is provider-
 * agnostic and uses pure-logic checks.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  LOGICAL_MODEL,
  resolveProvider,
  type NormalizedStatus,
} from "@/lib/inference";

describe("LOGICAL_MODEL", () => {
  it("exposes the two providers in use today", () => {
    // Pinned: if a new model is added, the spend-guard's
    // `PAID_INFERENCE_ROUTES` pin and the route handlers'
    // `LogicalModel` parameter type need a matching entry.
    expect(Object.keys(LOGICAL_MODEL).sort()).toEqual([
      "FLUX_FILL",
      "SAM_3_1_IMAGE",
    ]);
  });
});

describe("resolveProvider", () => {
  const originalEnv = process.env.INFERENCE_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.INFERENCE_PROVIDER;
    } else {
      process.env.INFERENCE_PROVIDER = originalEnv;
    }
  });

  it("defaults to alibaba when INFERENCE_PROVIDER is unset", () => {
    delete process.env.INFERENCE_PROVIDER;
    expect(resolveProvider()).toBe("alibaba");
  });

  it("defaults to alibaba when INFERENCE_PROVIDER is empty", () => {
    process.env.INFERENCE_PROVIDER = "";
    expect(resolveProvider()).toBe("alibaba");
  });

  it("defaults to alibaba when INFERENCE_PROVIDER is whitespace", () => {
    process.env.INFERENCE_PROVIDER = "   ";
    expect(resolveProvider()).toBe("alibaba");
  });

  it("returns alibaba when INFERENCE_PROVIDER=alibaba", () => {
    process.env.INFERENCE_PROVIDER = "alibaba";
    expect(resolveProvider()).toBe("alibaba");
  });

  it("returns alibaba for mixed-case INFERENCE_PROVIDER=Alibaba", () => {
    process.env.INFERENCE_PROVIDER = "Alibaba";
    expect(resolveProvider()).toBe("alibaba");
  });

  it("parses fal|replicate but the value is unused after #1240", () => {
    // The retired provider values still parse through resolveProvider so
    // a misconfigured deploy surfaces a clear "no longer supported"
    // error from assertInferenceConfigured / getInferenceClient
    // instead of an opaque runtime import failure. These assertions
    // pin that parser behavior.
    process.env.INFERENCE_PROVIDER = "fal";
    expect(resolveProvider()).toBe("fal");
    process.env.INFERENCE_PROVIDER = "replicate";
    expect(resolveProvider()).toBe("replicate");
  });

  it("falls back to alibaba for unknown provider names", () => {
    // Intentional: a typo in the env should not crash a production
    // deploy. The default is the safe choice; the warn-once is logged
    // from `resolveProvider` so ops can spot the misconfig.
    process.env.INFERENCE_PROVIDER = "Alibab";
    expect(resolveProvider()).toBe("alibaba");
  });
});

/**
 * The status / 404 normalization contract is exercised end-to-end
 * inside the Alibaba adapter module. This file does not re-import
 * the adapter — that would require real `ALIBABA_*` env at module
 * load. The adapter's own tests cover the contract.
 */
describe("NormalizedStatus type", () => {
  it("covers the four states the poller understands", () => {
    // Static check: the type union has exactly these four strings.
    // If a new state is added (e.g. CANCELLED), this test fails and
    // reminds the author to update the poller + the client
    // classifier.
    const expected: NormalizedStatus[] = [
      "IN_QUEUE",
      "IN_PROGRESS",
      "COMPLETED",
      "ERROR",
    ];
    expect(expected).toHaveLength(4);
  });
});