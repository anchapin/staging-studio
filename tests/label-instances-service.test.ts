/**
 * Unit tests for `label-instances-service.ts` — the wave-5 revival of #933.
 *
 * The service is tested in isolation by passing hand-rolled `deps`. No
 * `vi.mock` and no live DB / OpenAI calls. Each export is asserted against
 * the canonical contract documented in the service file's JSDoc.
 *
 * The route-level behaviour is already pinned by
 * `tests/api/label-instances-route.test.ts` and `tests/label-instances-quota.test.ts`
 * — these tests focus on the pure helpers (prompt construction, response
 * shaping, schema coercion) and the deps-injected workflow steps.
 */
import type { User } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildLabelPromptMessages,
  extractRequestedLabels,
  mapCachedRowsToLabels,
  resolveInstanceCrops,
  runVisionLabelGeneration,
  stripBase64Prefix,
  validateLabelAccess,
  loadCachedLabels,
  persistLabelRows,
  type LabelInstanceOutput,
  type LabelInstancesServiceDeps,
} from "@/lib/label-instances-service";
import { ApiError } from "@/lib/api-error-handler";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockUser: User = {
  id: "user-1",
  firmName: "Firm",
  ownerName: "Owner",
  logoUrl: null,
  email: null,
  psychologyPageContent: null,
  signoffContent: null,
  darkMode: false,
  createdAt: new Date(0),
};

const fakeCachedRows = [
  { instanceIndex: 0, label: "Sofa", score: 0.9, editedLabel: null },
  { instanceIndex: 1, label: "Chair", score: 0.8, editedLabel: "Edited chair" },
];

function makeDeps(overrides: Partial<LabelInstancesServiceDeps> = {}): LabelInstancesServiceDeps {
  return {
    prisma: {
      room: {
        findFirst: vi.fn(async () => ({
          id: "room-1",
          projectId: "project-1",
        })),
      },
    },
    requireProjectOwnershipOrThrow: vi.fn(async () => ({ ok: true as const, projectId: "project-1" })),
    generateWithCircuitBreaker: vi.fn(async (fn) => fn()),
    generateObject: vi.fn(async () => ({
      object: { labels: [{ instanceIndex: 0, label: "Sofa" }] },
    })) as unknown as LabelInstancesServiceDeps["generateObject"],
    model: { modelId: "gpt-4o-mini" },
    getCachedVisionLabels: vi.fn(async () => fakeCachedRows),
    upsertVisionLabels: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("stripBase64Prefix", () => {
  it("strips the data URL prefix from a JPEG data URL", () => {
    expect(stripBase64Prefix("data:image/jpeg;base64,ABCD")).toBe("ABCD");
  });

  it("returns the input unchanged when there is no prefix", () => {
    expect(stripBase64Prefix("ABCD")).toBe("ABCD");
  });

  it("strips a PNG data URL prefix", () => {
    expect(stripBase64Prefix("data:image/png;base64,XYZ")).toBe("XYZ");
  });
});

describe("resolveInstanceCrops", () => {
  it("strips base64 prefixes and preserves ordering", () => {
    const out = resolveInstanceCrops([
      { instanceIndex: 2, cropDataUrl: "data:image/jpeg;base64,BBBB" },
      { instanceIndex: 0, cropDataUrl: "data:image/png;base64,AAAA" },
    ]);
    expect(out).toEqual([
      { instanceIndex: 2, cropDataUrl: "data:image/jpeg;base64,BBBB", base64: "BBBB" },
      { instanceIndex: 0, cropDataUrl: "data:image/png;base64,AAAA", base64: "AAAA" },
    ]);
  });
});

describe("buildLabelPromptMessages", () => {
  it("lists all requested instance indices in the user prompt", () => {
    const messages = buildLabelPromptMessages({
      concept: "Mid-Century Modern",
      instanceIndices: [0, 1, 2],
      cropsWithBytes: [
        { instanceIndex: 0, cropDataUrl: "data:image/jpeg;base64,AAA", base64: "AAA" },
        { instanceIndex: 1, cropDataUrl: "data:image/jpeg;base64,BBB", base64: "BBB" },
        { instanceIndex: 2, cropDataUrl: "data:image/jpeg;base64,CCC", base64: "CCC" },
      ],
    });
    expect(messages).toHaveLength(1);
    const first = messages[0];
    expect(first.role).toBe("user");
    const content = first.content as Array<{ type: string; text?: string; mediaType?: string; data?: string }>;
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("0, 1, 2");
    expect(content.slice(1)).toEqual([
      { type: "file", mediaType: "image/jpeg", data: "AAA" },
      { type: "file", mediaType: "image/jpeg", data: "BBB" },
      { type: "file", mediaType: "image/jpeg", data: "CCC" },
    ]);
  });
});

describe("extractRequestedLabels", () => {
  it("keeps only requested instance indices", () => {
    const object = {
      labels: [
        { instanceIndex: 0, label: "Sofa" },
        { instanceIndex: 1, label: "Chair" },
        { instanceIndex: 9, label: "Ignored" },
      ],
    };
    const out = extractRequestedLabels(object, [0, 1]);
    expect(out).toEqual([
      { instanceIndex: 0, label: "Sofa" },
      { instanceIndex: 1, label: "Chair" },
    ]);
  });

  it("returns [] when the provider returned no labels", () => {
    expect(extractRequestedLabels({}, [0, 1])).toEqual([]);
    expect(extractRequestedLabels({ labels: [] }, [0, 1])).toEqual([]);
  });
});

describe("mapCachedRowsToLabels", () => {
  it("prefers editedLabel over label when present", () => {
    const out = mapCachedRowsToLabels(fakeCachedRows, [0, 1]);
    expect(out).toEqual([
      { instanceIndex: 0, label: "Sofa" },
      { instanceIndex: 1, label: "Edited chair" },
    ]);
  });

  it("returns 'unknown' for missing instance indices", () => {
    const out = mapCachedRowsToLabels([fakeCachedRows[0]], [0, 1]);
    expect(out).toEqual([
      { instanceIndex: 0, label: "Sofa" },
      { instanceIndex: 1, label: "unknown" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Workflow steps (deps-injected)
// ---------------------------------------------------------------------------

describe("validateLabelAccess", () => {
  it("returns the room's projectId when access is allowed", async () => {
    const deps = makeDeps();
    const result = await validateLabelAccess("room-1", mockUser, deps);
    expect(result).toEqual({ roomId: "room-1", projectId: "project-1" });
    expect(deps.prisma.room.findFirst).toHaveBeenCalledWith({
      where: { id: "room-1" },
      select: { id: true, projectId: true },
    });
  });

  it("throws 404 (API_ERROR_ROOM_NOT_FOUND) when the room does not exist", async () => {
    const deps = makeDeps({
      prisma: { room: { findFirst: vi.fn(async () => null) } } as unknown as LabelInstancesServiceDeps["prisma"],
    });
    await expect(validateLabelAccess("missing", mockUser, deps)).rejects.toMatchObject({
      status: 404,
      code: "room-not-found",
    });
  });

  it("translates ProjectNotFoundError into a 404 room-not-found", async () => {
    const { ProjectNotFoundError } = await import("@/lib/api-auth");
    const deps = makeDeps({
      requireProjectOwnershipOrThrow: vi.fn(async () => {
        throw new ProjectNotFoundError("project-1");
      }) as unknown as LabelInstancesServiceDeps["requireProjectOwnershipOrThrow"],
    });
    await expect(validateLabelAccess("room-1", mockUser, deps)).rejects.toBeInstanceOf(ApiError);
    await expect(validateLabelAccess("room-1", mockUser, deps)).rejects.toMatchObject({
      status: 404,
      code: "room-not-found",
    });
  });

  it("translates ProjectForbiddenError into a 403 forbidden", async () => {
    const { ProjectForbiddenError } = await import("@/lib/api-auth");
    const deps = makeDeps({
      requireProjectOwnershipOrThrow: vi.fn(async () => {
        throw new ProjectForbiddenError("project-1");
      }) as unknown as LabelInstancesServiceDeps["requireProjectOwnershipOrThrow"],
    });
    await expect(validateLabelAccess("room-1", mockUser, deps)).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });
});

describe("loadCachedLabels", () => {
  it("delegates to getCachedVisionLabels with the cache key", async () => {
    const deps = makeDeps();
    const rows = await loadCachedLabels(
      {
        imageUrl: "https://example.supabase.co/x.png",
        concept: "Modern",
        instanceIndices: [0, 1],
        userId: "user-1",
      },
      deps,
    );
    expect(deps.getCachedVisionLabels).toHaveBeenCalledWith({
      imageUrl: "https://example.supabase.co/x.png",
      concept: "Modern",
      instanceIndices: [0, 1],
      userId: "user-1",
    });
    expect(rows).toEqual(fakeCachedRows);
  });
});

describe("runVisionLabelGeneration", () => {
  it("calls generateWithCircuitBreaker(generateObject(...)) and unwraps `.object`", async () => {
    const generateObject = vi.fn(async () => ({
      object: { labels: [{ instanceIndex: 0, label: "Sofa" }] },
    }));
    const generateWithCircuitBreaker = vi.fn(async (fn: () => unknown) => fn());
    const deps = makeDeps({
      generateObject: generateObject as unknown as LabelInstancesServiceDeps["generateObject"],
      generateWithCircuitBreaker: generateWithCircuitBreaker as unknown as LabelInstancesServiceDeps["generateWithCircuitBreaker"],
    });
    const out = await runVisionLabelGeneration({ schema: {}, messages: {} }, deps);
    expect(generateWithCircuitBreaker).toHaveBeenCalledTimes(1);
    expect(generateObject).toHaveBeenCalledWith({
      model: deps.model,
      schema: {},
      messages: {},
    });
    expect(out.object).toEqual({ labels: [{ instanceIndex: 0, label: "Sofa" }] });
  });
});

describe("persistLabelRows", () => {
  it("maps labels to the upsertVisionLabels input shape", async () => {
    const upsertVisionLabels = vi.fn(async () => undefined);
    const deps = makeDeps({
      upsertVisionLabels: upsertVisionLabels as unknown as LabelInstancesServiceDeps["upsertVisionLabels"],
    });
    const labels: LabelInstanceOutput[] = [
      { instanceIndex: 0, label: "Sofa" },
      { instanceIndex: 1, label: "Chair" },
    ];
    await persistLabelRows(
      {
        imageUrl: "https://x/y.png",
        concept: "Modern",
        userId: "user-1",
        roomId: "room-1",
      },
      labels,
      deps,
    );
    expect(upsertVisionLabels).toHaveBeenCalledWith({
      imageUrl: "https://x/y.png",
      concept: "Modern",
      results: [
        { instanceIndex: 0, label: "Sofa" },
        { instanceIndex: 1, label: "Chair" },
      ],
      userId: "user-1",
      roomId: "room-1",
    });
  });

  it("does not call upsertVisionLabels when there are no labels", async () => {
    const upsertVisionLabels = vi.fn(async () => undefined);
    const deps = makeDeps({
      upsertVisionLabels: upsertVisionLabels as unknown as LabelInstancesServiceDeps["upsertVisionLabels"],
    });
    await persistLabelRows(
      { imageUrl: "x", concept: "x", userId: "u", roomId: "r" },
      [],
      deps,
    );
    expect(upsertVisionLabels).not.toHaveBeenCalled();
  });
});