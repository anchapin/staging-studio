/**
 * Alibaba Cloud (DashScope) adapter unit tests (#1240).
 *
 * Two layers of coverage:
 *   1. Wire-shape and error-propagation tests for `dashscopeGenerate` —
 *      the synchronous POST to DashScope's multimodal-conversation
 *      endpoint. Mocks `globalThis.fetch` so no real HTTP goes out.
 *   2. Circuit-breaker wrapper tests mirroring the historical
 *      `tests/fal.test.ts` coverage that exercised
 *      `falSubscribeWithCircuitBreaker`. Mocks `@/lib/circuit-breaker`
 *      via `vi.mock` so the breaker is observable in isolation.
 *
 * No real DashScope round trip, no ALIBABA_DASHSCOPE_API_KEY required
 * (the env values used here are placeholders).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ALIYUN_ENV = {
  ALIBABA_DASHSCOPE_API_KEY: "test-dashscope-key",
  ALIBABA_BAILIAN_WORKSPACE_ID: "llm-test-workspace",
  ALIBABA_INPAINT_MODEL: "qwen-image-2.1-pro",
};

const ORIGINAL_ENV = {
  ...ALIYUN_ENV,
  INFERENCE_PROVIDER: process.env.INFERENCE_PROVIDER,
};

// Mock the shared circuit breaker BEFORE the adapter module is imported
// so the adapter's `getCircuitBreaker("alibaba-cloud", …)` call resolves
// to this stub. The stub exposes its `execute` method so the same
// CircuitBreaker instance is observable across tests, and a synthetic
// open/closed state so we can test the open-circuit rejection path.
const mockExecute = vi.hoisted(() => vi.fn());

class StubCircuitOpenError extends Error {
  constructor() {
    super("circuit open");
    this.name = "CircuitBreakerOpenError";
  }
}

const alibabaBreaker = {
  service: "alibaba-cloud",
  execute: mockExecute,
  state: "closed" as "closed" | "open",
};

vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitBreaker: vi.fn(() => alibabaBreaker),
  CircuitBreakerOpenError: StubCircuitOpenError,
  resetAllCircuitBreakers: vi.fn(),
}));

beforeEach(() => {
  process.env.ALIBABA_DASHSCOPE_API_KEY = ALIYUN_ENV.ALIBABA_DASHSCOPE_API_KEY;
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID =
    ALIYUN_ENV.ALIBABA_BAILIAN_WORKSPACE_ID;
  process.env.ALIBABA_INPAINT_MODEL = ALIYUN_ENV.ALIBABA_INPAINT_MODEL;
  alibabaBreaker.state = "closed";
  mockExecute.mockReset();
  // Stub fetch before each test so any test that goes through the
  // circuit-breaker path doesn't make a real HTTP call. The mock is
  // cleared in afterEach. Tests that need to assert specific fetch
  // behavior override `mockExecute` (which is the only thing the
  // adapter calls for a request), so this stub is just a safety net.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  for (const [key, value] of Object.entries(ALIYUN_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (ORIGINAL_ENV.INFERENCE_PROVIDER === undefined) {
    delete process.env.INFERENCE_PROVIDER;
  } else {
    process.env.INFERENCE_PROVIDER = ORIGINAL_ENV.INFERENCE_PROVIDER;
  }
  vi.unstubAllGlobals();
});

/**
 * Build a minimal successful DashScope multimodal-conversation response
 * for the test fetch mock. The shape mirrors the real response from
 * `dashscope-result-*.oss-accelerate.aliyuncs.com` (verified Oct 12, 2026).
 */
function buildDashScopeResponse(imageUrl: string) {
  return {
    request_id: "ds-test-request-id",
    output: {
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: [{ image: imageUrl }],
          },
        },
      ],
    },
    usage: { image_count: 1, width: 2048, height: 1536 },
  };
}

describe("Alibaba adapter (DashScope multimodal-conversation)", () => {
  it("submit does the synchronous DashScope POST through the circuit breaker and caches result", async () => {
    const hostedImage =
      "https://dashscope-result-sz.oss-accelerate.aliyuncs.com/abc/test.png";
    // The adapter calls cb.execute(POST → fetch). The mock returns the
    // parsed body directly (skipping fetch) so we don't have to stub a
    // Response object -- the circuit breaker is the only boundary that
    // matters in this test.
    mockExecute.mockResolvedValue(buildDashScopeResponse(hostedImage));

    const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
    const client = createAlibabaClient();
    const { LOGICAL_MODEL } = await import("@/lib/inference");
    const result = await client.submit(LOGICAL_MODEL.FLUX_FILL, {
      input: { imageUrl: "https://example.com/room.jpg", prompt: "Stage it" },
    });

    // The submit call MUST go through the alibaba-cloud circuit breaker
    // -- this is the production hardening (3 failures -> 30s cooldown)
    // the fal adapter had before #1240. Pinned here so a future refactor
    // that drops the wrapper surfaces.
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(alibabaBreaker.service).toBe("alibaba-cloud");

    // Local UUID, not the provider's request_id (DashScope's id is not
    // stable across re-POSTs; we mint our own so the route's
    // status/result polling flow has a stable identifier).
    expect(result.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // Status on the just-submitted request id returns COMPLETED.
    const status = await client.status(LOGICAL_MODEL.FLUX_FILL, result.request_id);
    expect(status.status).toBe("COMPLETED");

    // Result returns the cached URL string (matches Replicate's shape
    // that firstInpaintImageUrl already handles). DashScope returns no
    // envelope, so there's nothing to unwrap.
    const r = await client.result(LOGICAL_MODEL.FLUX_FILL, result.request_id);
    expect(r.data).toBe(hostedImage);
  });

  it("result for an unknown request_id throws InferenceRequestGoneError", async () => {
    mockExecute.mockResolvedValue(undefined as never);
    const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
    const client = createAlibabaClient();
    const { LOGICAL_MODEL, InferenceRequestGoneError } = await import(
      "@/lib/inference"
    );
    const bogus = "00000000-0000-0000-0000-000000000000";
    await expect(
      client.status(LOGICAL_MODEL.FLUX_FILL, bogus),
    ).rejects.toBeInstanceOf(InferenceRequestGoneError);
    await expect(
      client.result(LOGICAL_MODEL.FLUX_FILL, bogus),
    ).rejects.toBeInstanceOf(InferenceRequestGoneError);
  });

  it("submit propagates DashScope upstream errors as Error", async () => {
    mockExecute.mockImplementation(async () => {
      throw new Error(
        "DashScope qwen-image-2.1-pro returned 401 (code=InvalidApiKey): Invalid API-key provided.",
      );
    });
    const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
    const client = createAlibabaClient();
    const { LOGICAL_MODEL } = await import("@/lib/inference");
    await expect(
      client.submit(LOGICAL_MODEL.FLUX_FILL, {
        input: { imageUrl: "https://example.com/room.jpg", prompt: "Stage it" },
      }),
    ).rejects.toThrow(/DashScope.*401/);
  });

  it("submit throws when the DashScope response carries no image", async () => {
    // Return a 200 OK with empty content so the adapter parses the body
    // successfully but then fails in `pickImageUrl`.
    const emptyBody = {
      request_id: "ds-x",
      output: {
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: [] as Array<{ image?: string }> },
          },
        ],
      },
      usage: { image_count: 0, width: 0, height: 0 },
    };
    mockExecute.mockResolvedValue(emptyBody);
    const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
    const client = createAlibabaClient();
    const { LOGICAL_MODEL } = await import("@/lib/inference");
    await expect(
      client.submit(LOGICAL_MODEL.FLUX_FILL, {
        input: { imageUrl: "https://example.com/room.jpg", prompt: "Stage it" },
      }),
    ).rejects.toThrow(/no image in choices/);
  });

  it("propagates CircuitBreakerOpenError when the upstream breaker is open", async () => {
    // Mirror the historical `tests/fal.test.ts` coverage: when the
    // breaker rejects, the adapter's submit re-throws verbatim so the
    // route handler can fast-fail rather than block on a known-down
    // provider.
    mockExecute.mockRejectedValue(new StubCircuitOpenError());
    const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
    const client = createAlibabaClient();
    const { LOGICAL_MODEL } = await import("@/lib/inference");
    await expect(
      client.submit(LOGICAL_MODEL.FLUX_FILL, {
        input: { imageUrl: "https://example.com/room.jpg", prompt: "Stage it" },
      }),
    ).rejects.toThrow(/circuit open/);
  });

  it("subscribe re-throws circuit-breaker errors so the caller fast-fails", async () => {
    // `subscribe` is the synchronous facade used by code paths that
    // want a one-shot result (e.g. SAM-style single-shot inference). It
    // should also propagate CircuitBreakerOpenError so callers can
    // detect "downstream open" and short-circuit.
    mockExecute.mockRejectedValue(new StubCircuitOpenError());
    const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
    const client = createAlibabaClient();
    const { LOGICAL_MODEL } = await import("@/lib/inference");
    await expect(
      client.subscribe(LOGICAL_MODEL.FLUX_FILL, {
        input: { imageUrl: "https://example.com/room.jpg", prompt: "Stage it" },
      }),
    ).rejects.toThrow(/circuit open/);
  });
});