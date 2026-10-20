/**
 * Unit tests for `segment-furnishings-service.ts` — the wave-5 revival of
 * #933. The service is tested in isolation by passing hand-rolled `deps`.
 * No `vi.mock` and no live DB / inference calls.
 *
 * The route-level behaviour is already pinned by
 * `tests/api/segment-furnishings-route.test.ts` (TBD) — these tests focus
 * on the pure helpers (mask-result filtering, data-URL formatting) and the
 * deps-injected workflow steps.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  arrayBufferToDataUrl,
  defaultSegmentFurnishingsServiceDeps,
  fetchMaskAsDataUrl,
  keepScoresForSurvivingMasks,
  resolveMaskResults,
  runFurnishingDetection,
  validateSegmentAccess,
  type SegmentFurnishingsServiceDeps,
} from "@/lib/segment-furnishings-service";
import { requireUser } from "@/lib/test/require-user";

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("arrayBufferToDataUrl", () => {
  it("formats a buffer as data:image/<fmt>;base64,…", () => {
    const buffer = new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer;
    expect(arrayBufferToDataUrl(buffer, "image/png")).toBe(
      "data:image/png;base64,3q2+7w==",
    );
  });

  it("strips a charset suffix from the content-type", () => {
    const buffer = new Uint8Array([0x00, 0x01]).buffer;
    expect(arrayBufferToDataUrl(buffer, "image/jpeg; charset=utf-8")).toMatch(
      /^data:image\/jpeg;base64,/,
    );
  });

  it("falls back to image/png when content-type is missing or empty", () => {
    const buffer = new Uint8Array([0x00]).buffer;
    expect(arrayBufferToDataUrl(buffer, "")).toMatch(/^data:image\/png;base64,/);
  });
});

describe("resolveMaskResults", () => {
  it("keeps fulfilled results and drops rejected ones", () => {
    const results: Array<PromiseSettledResult<string>> = [
      { status: "fulfilled", value: "data:image/png;base64,AAA" },
      { status: "rejected", reason: new Error("404") },
      { status: "fulfilled", value: "data:image/png;base64,BBB" },
    ];
    expect(resolveMaskResults(results)).toEqual([
      "data:image/png;base64,AAA",
      "data:image/png;base64,BBB",
    ]);
  });

  it("returns an empty list when all results rejected", () => {
    const results: Array<PromiseSettledResult<string>> = [
      { status: "rejected", reason: new Error("404") },
    ];
    expect(resolveMaskResults(results)).toEqual([]);
  });
});

describe("keepScoresForSurvivingMasks", () => {
  it("keeps only the scores for fulfilled masks, in order", () => {
    const results: Array<PromiseSettledResult<string>> = [
      { status: "fulfilled", value: "AAA" },
      { status: "rejected", reason: new Error("404") },
      { status: "fulfilled", value: "BBB" },
    ];
    expect(keepScoresForSurvivingMasks(results, [0.9, 0.8, 0.7])).toEqual([0.9, 0.7]);
  });

  it("returns undefined when scores is undefined", () => {
    const results: Array<PromiseSettledResult<string>> = [
      { status: "fulfilled", value: "AAA" },
    ];
    expect(keepScoresForSurvivingMasks(results, undefined)).toBeUndefined();
  });

  it("returns an empty list when every mask failed", () => {
    const results: Array<PromiseSettledResult<string>> = [
      { status: "rejected", reason: new Error("404") },
    ];
    expect(keepScoresForSurvivingMasks(results, [0.9])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Default deps shape (smoke — only asserts the wiring, not the IO behaviour)
// ---------------------------------------------------------------------------

describe("defaultSegmentFurnishingsServiceDeps", () => {
  it("returns a non-empty deps bag with the SAM 3.1 logical model", () => {
    const deps = defaultSegmentFurnishingsServiceDeps();
    expect(deps.logicalModel).toBe("sam-3-1-image");
    expect(typeof deps.buildPayload).toBe("function");
    expect(typeof deps.parseResponse).toBe("function");
    expect(typeof deps.subscribe).toBe("function");
    expect(typeof deps.assertInferenceConfigured).toBe("function");
    expect(typeof deps.fetch).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Workflow steps (deps-injected)
// ---------------------------------------------------------------------------

// Issue #1393: shared `requireUser()` factory. We only need the minimal
// `id` field for the param-passed service signature, so the rest of the
// fixture is discarded.
const { user: mockUser } = requireUser({ id: "user-1" });

function makeDeps(overrides: Partial<SegmentFurnishingsServiceDeps> = {}): SegmentFurnishingsServiceDeps {
  return {
    prisma: {
      room: {
        findFirst: vi.fn(async () => ({
          id: "room-1",
          projectId: "project-1",
          afterImageUrl: "https://x/y.png",
        })),
      },
    },
    buildPayload: vi.fn(() => ({ input: "payload" })),
    parseResponse: vi.fn(() => ({ maskUrls: ["https://x/mask1.png"], scores: [0.9] })),
    subscribe: vi.fn(async () => ({ result: "ok" })),
    logicalModel: "sam-3-1-image",
    assertInferenceConfigured: vi.fn(),
    fetch: vi.fn(async () =>
      new Response(new Uint8Array([0xde, 0xad]).buffer, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    ),
    ...overrides,
  };
}

describe("validateSegmentAccess", () => {
  it("returns the room + projectId when the room exists and is owned", async () => {
    const deps = makeDeps();
    const out = await validateSegmentAccess({ roomId: "room-1" }, mockUser, deps);
    expect(out).toEqual({
      roomId: "room-1",
      room: {
        id: "room-1",
        projectId: "project-1",
        afterImageUrl: "https://x/y.png",
      },
    });
  });

  it("throws 401 when no user is set", async () => {
    const deps = makeDeps();
    await expect(
      validateSegmentAccess({ roomId: "room-1" }, null, deps),
    ).rejects.toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("throws 404 when the room does not exist", async () => {
    const deps = makeDeps({
      prisma: {
        room: { findFirst: vi.fn(async () => null) },
      },
    });
    await expect(
      validateSegmentAccess({ roomId: "missing" }, mockUser, deps),
    ).rejects.toMatchObject({ status: 404, code: "room-not-found" });
  });
});

describe("fetchMaskAsDataUrl", () => {
  it("returns a data URL on a 200 response", async () => {
    const deps = makeDeps();
    const out = await fetchMaskAsDataUrl("https://x/mask.png", deps);
    expect(out).toMatch(/^data:image\/png;base64,/);
  });

  it("throws 502 on a non-2xx response", async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => new Response("not found", { status: 404 })),
    });
    await expect(fetchMaskAsDataUrl("https://x/mask.png", deps)).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe("runFurnishingDetection", () => {
  it("calls assertInferenceConfigured, buildPayload, subscribe, parseResponse", async () => {
    const deps = makeDeps();
    const controller = new AbortController();
    const out = await runFurnishingDetection(
      { imageUrl: "https://x/y.png", abortSignal: controller.signal },
      deps,
    );
    expect(deps.assertInferenceConfigured).toHaveBeenCalled();
    expect(deps.buildPayload).toHaveBeenCalledWith({ imageUrl: "https://x/y.png" });
    expect(deps.subscribe).toHaveBeenCalled();
    expect(deps.parseResponse).toHaveBeenCalled();
    expect(out.masks).toEqual([expect.stringMatching(/^data:image\/png;base64,/)]);
    expect(out.maskUrls).toEqual(["https://x/mask1.png"]);
  });

  it("throws 502 when parseResponse returns null", async () => {
    const deps = makeDeps({
      parseResponse: vi.fn(() => null) as unknown as SegmentFurnishingsServiceDeps["parseResponse"],
    });
    const controller = new AbortController();
    await expect(
      runFurnishingDetection(
        { imageUrl: "https://x/y.png", abortSignal: controller.signal },
        deps,
      ),
    ).rejects.toMatchObject({ status: 502, code: "invalid-request" });
  });

  it("plumbs the abortSignal through to the subscribe call", async () => {
    const deps = makeDeps();
    const controller = new AbortController();
    await runFurnishingDetection(
      { imageUrl: "https://x/y.png", abortSignal: controller.signal },
      deps,
    );
    const subscribeCall = vi.mocked(deps.subscribe).mock.calls[0];
    expect(subscribeCall[1].abortSignal).toBe(controller.signal);
  });
});