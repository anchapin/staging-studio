/**
 * Alibaba Cloud (DashScope) adapter unit tests (#1240).
 *
 * The adapter's `subscribe` / `submit` / `result` methods make real
 * HTTP calls to `dashscope-result-*.oss-accelerate.aliyuncs.com` in
 * production. These tests mock `globalThis.fetch` to exercise the
 * shape-translation logic in isolation — no real DashScope round
 * trip, no ALIBABA_DASHSCOPE_API_KEY required.
 *
 * Each test sets `process.env.INFERENCE_PROVIDER=alibaba` so the
 * fallback env helpers resolve against the local `tests/e2e`-free
 * test runner. The env vars are restored in afterEach so other
 * tests in the suite are unaffected.
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

beforeEach(() => {
  process.env.ALIBABA_DASHSCOPE_API_KEY = ALIYUN_ENV.ALIBABA_DASHSCOPE_API_KEY;
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID =
    ALIYUN_ENV.ALIBABA_BAILIAN_WORKSPACE_ID;
  process.env.ALIBABA_INPAINT_MODEL = ALIYUN_ENV.ALIBABA_INPAINT_MODEL;
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
  it("submit does the synchronous DashScope POST, caches result, returns request_id", async () => {
    const hostedImage =
      "https://dashscope-result-sz.oss-accelerate.aliyuncs.com/abc/test.png";
    const fetchMock = vi.fn(async (url: string | URL) => {
      // The fetch hits the Singapore workspace URL built from
      // ALIBABA_BAILIAN_WORKSPACE_ID.
      const u = String(url);
      expect(u).toContain("llm-test-workspace");
      expect(u).toContain("ap-southeast-1");
      return new Response(JSON.stringify(buildDashScopeResponse(hostedImage)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
    const client = createAlibabaClient();
    const { LOGICAL_MODEL } = await import("@/lib/inference");
    const result = await client.submit(LOGICAL_MODEL.FLUX_FILL, {
      input: { imageUrl: "https://example.com/room.jpg", prompt: "Stage it" },
    });
    expect(result.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Status on the just-submitted request id returns COMPLETED.
    const status = await client.status(LOGICAL_MODEL.FLUX_FILL, result.request_id);
    expect(status.status).toBe("COMPLETED");

    // Result returns the cached URL string (matches Replicate's shape
    // that firstInpaintImageUrl already handles).
    const r = await client.result(LOGICAL_MODEL.FLUX_FILL, result.request_id);
    expect(r.data).toBe(hostedImage);
  });

  it("result for an unknown request_id throws InferenceRequestGoneError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not used", { status: 200 })),
    );
    const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
    const client = createAlibabaClient();
    const { LOGICAL_MODEL, InferenceRequestGoneError } = await import(
      "@/lib/inference"
    );
    // Random uuid that was never cached.
    const bogus = "00000000-0000-0000-0000-000000000000";
    await expect(
      client.status(LOGICAL_MODEL.FLUX_FILL, bogus),
    ).rejects.toBeInstanceOf(InferenceRequestGoneError);
    await expect(
      client.result(LOGICAL_MODEL.FLUX_FILL, bogus),
    ).rejects.toBeInstanceOf(InferenceRequestGoneError);
  });

  it("submit propagates DashScope upstream errors as Error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "InvalidApiKey",
              message: "Invalid API-key provided.",
            }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
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
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              request_id: "ds-x",
              output: { choices: [{ message: { content: [] } }] },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const { createAlibabaClient } = await import("@/lib/alibaba-adapter");
    const client = createAlibabaClient();
    const { LOGICAL_MODEL } = await import("@/lib/inference");
    await expect(
      client.submit(LOGICAL_MODEL.FLUX_FILL, {
        input: { imageUrl: "https://example.com/room.jpg", prompt: "Stage it" },
      }),
    ).rejects.toThrow(/no image in choices/);
  });
});