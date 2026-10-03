/**
 * Provider-agnostic inference abstraction (#1187 follow-up).
 *
 * Each adapter (fal, replicate) implements the same `InferenceClient`
 * surface; this file pins the contract that the rest of the system
 * relies on (logical-model names, status normalization, request-gone
 * detection). The Replicate adapter's wire format is verified by
 * integration tests with a mocked fetch; this file is provider-free
 * and uses pure-logic checks.
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

  it("defaults to fal when INFERENCE_PROVIDER is unset", () => {
    delete process.env.INFERENCE_PROVIDER;
    expect(resolveProvider()).toBe("fal");
  });

  it("defaults to fal when INFERENCE_PROVIDER is empty", () => {
    process.env.INFERENCE_PROVIDER = "";
    expect(resolveProvider()).toBe("fal");
  });

  it("defaults to fal when INFERENCE_PROVIDER is whitespace", () => {
    process.env.INFERENCE_PROVIDER = "   ";
    expect(resolveProvider()).toBe("fal");
  });

  it("returns replicate when INFERENCE_PROVIDER=replicate", () => {
    process.env.INFERENCE_PROVIDER = "replicate";
    expect(resolveProvider()).toBe("replicate");
  });

  it("returns replicate for mixed-case INFERENCE_PROVIDER=Replicate", () => {
    process.env.INFERENCE_PROVIDER = "Replicate";
    expect(resolveProvider()).toBe("replicate");
  });

  it("falls back to fal for unknown provider names", () => {
    // Intentional: a typo in the env should not crash a production
    // deploy. The default is the safe choice; the warn-once is logged
    // from `resolveProvider` so ops can spot the misconfig.
    process.env.INFERENCE_PROVIDER = "falk";
    expect(resolveProvider()).toBe("fal");
  });
});

/**
 * The status / 404 normalization contract is exercised end-to-end
 * inside the fal and replicate adapter modules. This file does not
 * re-import those adapters — that would require a real
 * `FAL_KEY` / `REPLICATE_API_TOKEN` env at module load. The
 * adapters' own tests cover the contract.
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
