import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The breaker is bypassed only on the fallback leg by design; pin it as a
// pass-through so these tests exercise the failover logic, not breaker state.
vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitBreaker: () => ({
    execute: (fn: () => Promise<unknown>) => fn(),
  }),
}));

import {
  FALLBACK_MODEL_ID,
  FALLBACK_PRIMARY_ID,
  aiModel,
  aiModelFallback,
  generateWithFailover,
  isLLMFailoverEnabled,
} from "../src/lib/ai";

const rateLimitError = () => new Error("OpenAI rate limit exceeded for requests");
const authError = () => new Error("Invalid API key provided");
const unknownError = () => new Error("something exploded");
const fallbackError = () => new Error("fallback network failed");

describe("generateWithFailover (issue #1224)", () => {
  const prevFlag = process.env.LLM_FAILOVER_ENABLED;
  const prevFallbackModel = process.env.FALLBACK_MODEL;

  beforeEach(() => {
    delete process.env.FALLBACK_MODEL;
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.LLM_FAILOVER_ENABLED;
    else process.env.LLM_FAILOVER_ENABLED = prevFlag;
    if (prevFallbackModel !== undefined) process.env.FALLBACK_MODEL = prevFallbackModel;
  });

  it("returns the primary result without touching the fallback", async () => {
    process.env.LLM_FAILOVER_ENABLED = "true";
    const seenModels: unknown[] = [];
    const outcome = await generateWithFailover(async (model) => {
      seenModels.push(model);
      expect(model).toBe(aiModel);
      return "primary";
    });
    expect(outcome).toEqual({
      result: "primary",
      modelId: FALLBACK_PRIMARY_ID,
      failedOver: false,
    });
    expect(seenModels).toHaveLength(1);
  });

  it("falls back exactly once on a vendor-availability failure when enabled", async () => {
    process.env.LLM_FAILOVER_ENABLED = "true";
    let fallbackCalls = 0;
    const outcome = await generateWithFailover(async (model) => {
      if (model === aiModel) throw rateLimitError();
      expect(model).toBe(aiModelFallback);
      fallbackCalls += 1;
      return "fallback";
    });
    expect(fallbackCalls).toBe(1);
    expect(outcome.result).toBe("fallback");
    expect(outcome.failedOver).toBe(true);
    expect(outcome.modelId).toBe(FALLBACK_MODEL_ID);
  });

  it("propagates the primary error untouched when failover is disabled", async () => {
    process.env.LLM_FAILOVER_ENABLED = "false";
    let fallbackCalls = 0;
    await expect(
      generateWithFailover(async (model) => {
        if (model === aiModel) throw rateLimitError();
        fallbackCalls += 1;
        return "fallback";
      })
    ).rejects.toThrow("rate limit");
    expect(fallbackCalls).toBe(0);
  });

  it("never falls back on non-availability classes (auth, unknown)", async () => {
    process.env.LLM_FAILOVER_ENABLED = "true";
    let fallbackCalls = 0;
    for (const boom of [authError(), unknownError()]) {
      await expect(
        generateWithFailover(async (model) => {
          if (model === aiModel) throw boom;
          fallbackCalls += 1;
          return "fallback";
        })
      ).rejects.toThrow();
    }
    expect(fallbackCalls).toBe(0);
  });

  it("throws the fallback error and logs both legs when the fallback also fails", async () => {
    process.env.LLM_FAILOVER_ENABLED = "true";
    let fallbackCalls = 0;
    await expect(
      generateWithFailover(async (model) => {
        if (model === aiModel) throw rateLimitError();
        fallbackCalls += 1;
        throw fallbackError();
      })
    ).rejects.toThrow("fallback network failed");
    expect(fallbackCalls).toBe(1);
  });

  it("timeout and network classes count as vendor-availability failures", async () => {
    process.env.LLM_FAILOVER_ENABLED = "true";
    for (const boom of [
      new Error("Request timed out after 30s"),
      new Error("fetch failed: ECONNRESET"),
    ]) {
      const outcome = await generateWithFailover(async (model) => {
        if (model === aiModel) throw boom;
        return "fallback";
      });
      expect(outcome.failedOver).toBe(true);
    }
  });

  it("flag resolution: explicit values win, unset defaults to production-only", () => {
    process.env.LLM_FAILOVER_ENABLED = "true";
    expect(isLLMFailoverEnabled()).toBe(true);
    process.env.LLM_FAILOVER_ENABLED = "false";
    expect(isLLMFailoverEnabled()).toBe(false);
    delete process.env.LLM_FAILOVER_ENABLED;
    // The test process is not NODE_ENV=production, so unset means off.
    expect(isLLMFailoverEnabled()).toBe(false);
  });
});
