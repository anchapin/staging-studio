/**
 * OpenAI GPT-Image adapter unit tests (issue #1506), mirroring
 * tests/alibaba-adapter.test.ts:
 *   1. Wire-shape tests for the edits call — mocked global fetch, so
 *      no real HTTP. Asserts the multipart form carries the model,
 *      the pinned 1536x1024 size, and a guidance mask whose alpha is
 *      255 everywhere (the #1502 invariant) at the PNG level.
 *   2. InferenceClient lifecycle: submit returns the sync result +
 *      local request id; status/result serve from the cache; unknown
 *      ids throw InferenceRequestGoneError; cancel reports
 *      cancelled:false (synchronous API, no cancel endpoint).
 *   3. Env gating: a missing OPENAI_API_KEY fails before any fetch.
 *
 * Supabase storage is mocked (the adapter re-hosts the result PNG and
 * returns its public URL); the circuit breaker is stubbed to a
 * pass-through.
 */
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGICAL_MODEL } from "@/lib/inference";

const mockExecute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitBreaker: vi.fn(() => ({
    service: "openai",
    execute: mockExecute,
    state: "closed" as const,
  })),
}));

const mockUpload = vi.hoisted(() => vi.fn());
const mockGetPublicUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({
  createSupabaseRequestClient: vi.fn(async () => ({
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      })),
    },
  })),
}));

function pngBytes(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number, number],
): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const [r, g, b, a] = paint(x, y);
      png.data[o] = r;
      png.data[o + 1] = g;
      png.data[o + 2] = b;
      png.data[o + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

const SOURCE_PNG = pngBytes(8, 8, () => [120, 120, 120, 255]);
// Grayscale mask, white square = edit region.
const MASK_PNG = pngBytes(8, 8, (x, y) =>
  x >= 2 && x <= 5 && y >= 2 && y <= 5
    ? [255, 255, 255, 255]
    : [0, 0, 0, 255],
);
const RESULT_PNG = pngBytes(8, 8, () => [30, 60, 90, 255]);

let capturedForms: FormData[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

function installFetchMock(editsStatus = 200) {
  capturedForms = [];
  fetchMock = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const u = String(url);
    if (u === "https://example.com/room.png") {
      return new Response(new Uint8Array(SOURCE_PNG), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (u === "https://example.com/mask.png") {
      return new Response(new Uint8Array(MASK_PNG), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (u === "https://api.openai.com/v1/images/edits") {
      capturedForms.push(init?.body as FormData);
      if (editsStatus !== 200) {
        return Response.json(
          { error: { message: "upstream boom" } },
          { status: editsStatus },
        );
      }
      return Response.json({
        data: [{ b64_json: RESULT_PNG.toString("base64") }],
      });
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockExecute.mockReset();
  mockExecute.mockImplementation(async (fn: () => Promise<unknown>) => fn());
  mockUpload.mockReset();
  mockUpload.mockResolvedValue({ data: { path: "x" }, error: null });
  mockGetPublicUrl.mockReset();
  mockGetPublicUrl.mockReturnValue({
    data: { publicUrl: "https://storage.example/after-x.png" },
  });
  process.env.OPENAI_API_KEY = "<redacted>";
  delete process.env.OPENAI_INPAINT_MODEL;
  delete process.env.OPENAI_INPAINT_COMPOSITE;
  installFetchMock();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("openai adapter submit", () => {
  it("posts a multipart edits call with an opaque guidance mask and returns the re-hosted URL", async () => {
    const { createOpenAiClient } = await import("@/lib/openai-adapter");
    const client = createOpenAiClient();
    const out = await client.submit(LOGICAL_MODEL.FLUX_FILL, {
      input: {
        imageUrl: "https://example.com/room.png",
        maskUrl: "https://example.com/mask.png",
        prompt: "Stage it",
      },
    });

    expect(out.request_id).toBeTruthy();
    expect(out.result?.imageUrl).toBe("https://storage.example/after-x.png");
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][0]).toBe(`after-${out.request_id}.png`);

    expect(capturedForms).toHaveLength(1);
    const form = capturedForms[0];
    expect(form.get("model")).toBe("gpt-image-2.6-flare");
    expect(form.get("size")).toBe("1536x1024");
    expect(form.get("prompt")).toBe("Stage it");

    const maskBlob = form.get("mask") as Blob;
    const maskPng = PNG.sync.read(
      Buffer.from(await maskBlob.arrayBuffer()),
    );
    for (let i = 0; i < maskPng.width * maskPng.height; i++) {
      const o = i * 4;
      // Alpha invariant (#1502): never varies.
      expect(maskPng.data[o + 3]).toBe(255);
      // Edit square (x,y in [2,5]) is black; the rest is white.
      const x = i % maskPng.width;
      const y = Math.floor(i / maskPng.width);
      const inside = x >= 2 && x <= 5 && y >= 2 && y <= 5;
      expect(maskPng.data[o]).toBe(inside ? 0 : 255);
    }
  });

  it("serves status/result from the cache and rejects unknown ids", async () => {
    const { createOpenAiClient } = await import("@/lib/openai-adapter");
    const client = createOpenAiClient();
    const out = await client.submit(LOGICAL_MODEL.FLUX_FILL, {
      input: {
        imageUrl: "https://example.com/room.png",
        maskUrl: "https://example.com/mask.png",
        prompt: "Stage it",
      },
    });
    await expect(
      client.status(LOGICAL_MODEL.FLUX_FILL, out.request_id),
    ).resolves.toEqual({ status: "COMPLETED" });
    await expect(
      client.result(LOGICAL_MODEL.FLUX_FILL, out.request_id),
    ).resolves.toEqual({ data: "https://storage.example/after-x.png" });
    await expect(
      client.status(LOGICAL_MODEL.FLUX_FILL, "nope"),
    ).rejects.toThrow(/no longer in the in-process cache/);
  });

  it("cancel reports cancelled:false and evicts the cache entry", async () => {
    const { createOpenAiClient } = await import("@/lib/openai-adapter");
    const client = createOpenAiClient();
    const out = await client.submit(LOGICAL_MODEL.FLUX_FILL, {
      input: {
        imageUrl: "https://example.com/room.png",
        maskUrl: "https://example.com/mask.png",
        prompt: "Stage it",
      },
    });
    const cancel = await client.cancel!(
      LOGICAL_MODEL.FLUX_FILL,
      out.request_id,
    );
    expect(cancel.cancelled).toBe(false);
    expect(cancel.reason).toContain("no_cancel_endpoint");
    await expect(
      client.status(LOGICAL_MODEL.FLUX_FILL, out.request_id),
    ).rejects.toThrow(/no longer in the in-process cache/);
  });

  it("propagates an upstream edits error", async () => {
    installFetchMock(500);
    const { createOpenAiClient } = await import("@/lib/openai-adapter");
    const client = createOpenAiClient();
    await expect(
      client.submit(LOGICAL_MODEL.FLUX_FILL, {
        input: {
          imageUrl: "https://example.com/room.png",
          maskUrl: "https://example.com/mask.png",
          prompt: "Stage it",
        },
      }),
    ).rejects.toThrow(/returned 500: upstream boom/);
  });

  it("fails before any fetch when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const { createOpenAiClient } = await import("@/lib/openai-adapter");
    const client = createOpenAiClient();
    await expect(
      client.submit(LOGICAL_MODEL.FLUX_FILL, {
        input: {
          imageUrl: "https://example.com/room.png",
          maskUrl: "https://example.com/mask.png",
          prompt: "Stage it",
        },
      }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("inference provider selection (openai)", () => {
  it("resolveProvider + assertInferenceConfigured accept openai with only the API key", async () => {
    process.env.INFERENCE_PROVIDER = "openai";
    const { resolveProvider, assertInferenceConfigured } = await import(
      "@/lib/inference"
    );
    expect(resolveProvider()).toBe("openai");
    expect(() => assertInferenceConfigured()).not.toThrow();
    delete process.env.OPENAI_API_KEY;
    expect(() => assertInferenceConfigured()).toThrow(/OPENAI_API_KEY/);
  });

  it("buildInpaintPayloadForActiveProvider routes openai to the logical passthrough", async () => {
    process.env.INFERENCE_PROVIDER = "openai";
    const { buildInpaintPayloadForActiveProvider } = await import(
      "@/lib/prompts"
    );
    expect(
      buildInpaintPayloadForActiveProvider({
        imageUrl: "https://example.com/room.png",
        maskUrl: "https://example.com/mask.png",
        prompt: "Stage it",
      }),
    ).toEqual({
      imageUrl: "https://example.com/room.png",
      maskUrl: "https://example.com/mask.png",
      prompt: "Stage it",
    });
  });
});
