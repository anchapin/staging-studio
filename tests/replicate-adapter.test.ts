/**
 * Replicate adapter wire-format tests.
 *
 * Verifies that the Replicate HTTP call shapes (URL paths, request
 * bodies, response handling) match the Replicate API as of this
 * writing. The adapter is a thin REST client; these tests pin the
 * exact wire format so a Replicate-side change does not silently
 * break it.
 *
 * Side effects: mocks `globalThis.fetch` so no real network call
 * is made.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { createReplicateClient, ReplicateApiError } from "@/lib/replicate-adapter";
import {
  InferenceRequestGoneError,
  LOGICAL_MODEL,
} from "@/lib/inference";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.REPLICATE_API_TOKEN = "r8_test_token_abc123";
});

afterEach(() => {
  // Restore the env to the original snapshot so the next test
  // starts clean. `restore-each` semantics are critical here:
  // other tests in the suite read process.env at import time.
  for (const k of Object.keys(process.env)) {
    if (!(k in originalEnv)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v !== undefined) process.env[k] = v;
  }
  vi.restoreAllMocks();
});

const fetchMock = vi.fn() as unknown as Mock;

beforeEach(() => {
  // Stub `globalThis.fetch` so the adapter never hits the network.
  // The shape of each mock return is set per-test.
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe("submit", () => {
  it("POSTs to /v1/predictions with the version hash and input", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: "pred-abc-123", status: "starting" }),
    });
    const client = createReplicateClient();
    const result = await client.submit(LOGICAL_MODEL.FLUX_FILL, {
      input: { image: "https://x.test/i.png", prompt: "test" },
    });
    expect(result).toEqual({ request_id: "pred-abc-123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.replicate.com/v1/predictions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer r8_test_token_abc123",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(init.body);
    // Replicate's current /v1/predictions requires an explicit version
    // hash and rejects `model` (#1200 probe). Pin both: the version
    // must be present, and the legacy `model` key must not.
    expect(body.version).toBe(
      "41c767bcbfffe54ef8f05eb4d0100f9314790f7fc43a7b88d73ec06839deddb9"
    );
    expect(body.model).toBeUndefined();
    expect(body.input).toEqual({
      image: "https://x.test/i.png",
      prompt: "test",
    });
  });

  it("honors REPLICATE_FLUX_FILL_VERSION when set", async () => {
    process.env.REPLICATE_FLUX_FILL_VERSION =
      "b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: "pred-abc-123", status: "starting" }),
    });
    const client = createReplicateClient();
    await client.submit(LOGICAL_MODEL.FLUX_FILL, {
      input: { prompt: "x" },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.version).toBe(
      "b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1"
    );
  });

  it("does not put REPLICATE_FLUX_FILL_MODEL into the request body", async () => {
    // REPLICATE_FLUX_FILL_MODEL is read by the adapter (so the
    // deployment is logged correctly) but the wire body only carries
    // `version` — Replicate's API rejects `model` (#1200 probe). If
    // someone later adds `body.model = process.env.REPLICATE_FLUX_FILL_MODEL`
    // this test will fail.
    process.env.REPLICATE_FLUX_FILL_MODEL = "black-forest-labs/flux-fill-pro";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: "pred-abc-123", status: "starting" }),
    });
    const client = createReplicateClient();
    await client.submit(LOGICAL_MODEL.FLUX_FILL, {
      input: { prompt: "x" },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBeUndefined();
  });

  it("translates a 404 to InferenceRequestGoneError", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "not found" }),
    });
    const client = createReplicateClient();
    await expect(
      client.submit(LOGICAL_MODEL.FLUX_FILL, { input: { prompt: "x" } })
    ).rejects.toBeInstanceOf(InferenceRequestGoneError);
  });

  it("translates other non-2xx to ReplicateApiError", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ detail: "upstream broken" }),
    });
    const client = createReplicateClient();
    await expect(
      client.submit(LOGICAL_MODEL.FLUX_FILL, { input: { prompt: "x" } })
    ).rejects.toBeInstanceOf(ReplicateApiError);
  });
});

describe("status", () => {
  it("normalizes 'starting' to IN_QUEUE", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "pred-1", status: "starting" }),
    });
    const client = createReplicateClient();
    const result = await client.status(LOGICAL_MODEL.FLUX_FILL, "pred-1");
    expect(result.status).toBe("IN_QUEUE");
  });

  it("normalizes 'processing' to IN_PROGRESS", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "pred-1", status: "processing" }),
    });
    const client = createReplicateClient();
    const result = await client.status(LOGICAL_MODEL.FLUX_FILL, "pred-1");
    expect(result.status).toBe("IN_PROGRESS");
  });

  it("normalizes 'succeeded' to COMPLETED", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "pred-1", status: "succeeded" }),
    });
    const client = createReplicateClient();
    const result = await client.status(LOGICAL_MODEL.FLUX_FILL, "pred-1");
    expect(result.status).toBe("COMPLETED");
  });

  it("normalizes 'failed' and 'canceled' to ERROR", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "pred-1", status: "failed" }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "pred-2", status: "canceled" }),
    });
    const client = createReplicateClient();
    const a = await client.status(LOGICAL_MODEL.FLUX_FILL, "pred-1");
    const b = await client.status(LOGICAL_MODEL.FLUX_FILL, "pred-2");
    expect(a.status).toBe("ERROR");
    expect(b.status).toBe("ERROR");
  });
});

describe("result", () => {
  it("returns the prediction output as the data envelope", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: "pred-1",
        status: "succeeded",
        output: ["https://fal.media/x.png"],
      }),
    });
    const client = createReplicateClient();
    const { data } = await client.result(LOGICAL_MODEL.FLUX_FILL, "pred-1");
    expect(data).toEqual(["https://fal.media/x.png"]);
  });

  it("throws when the prediction is not in 'succeeded' state", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "pred-1", status: "processing" }),
    });
    const client = createReplicateClient();
    await expect(
      client.result(LOGICAL_MODEL.FLUX_FILL, "pred-1")
    ).rejects.toThrow(/not succeeded/);
  });
});

describe("subscribe", () => {
  it("returns the final output once the prediction reaches 'succeeded'", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: "pred-1", status: "starting" }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: "pred-1",
        status: "succeeded",
        output: "ok",
      }),
    });
    const client = createReplicateClient();
    const result = await client.subscribe<string>(LOGICAL_MODEL.FLUX_FILL, {
      input: { prompt: "x" },
    });
    expect(result).toBe("ok");
    // One submit, one poll; no more.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Pin subscribe's submit body the same way submit's body is
    // pinned above — both call sites share the same wire format.
    const submitCall = fetchMock.mock.calls[0];
    const submitBody = JSON.parse(submitCall[1].body);
    expect(submitBody.version).toBe(
      "41c767bcbfffe54ef8f05eb4d0100f9314790f7fc43a7b88d73ec06839deddb9"
    );
    expect(submitBody.model).toBeUndefined();
  });
});
