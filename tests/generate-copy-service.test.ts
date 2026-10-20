/**
 * Unit tests for `src/lib/generate-copy-service.ts`.
 *
 * Phase-2 of the Wave-5 revival (issue #1389): pins the discriminated
 * result returned by `runGenerateCopy` so the unversioned
 * /api/generate-copy route can keep its own terminal mapping without
 * regressing the shared orchestration.
 *
 * Hand-rolls the dependency surface with `vi.fn()`s (no `vi.mock`,
 * mirroring Phase-1 services in #1400/#1401 and PR-3 export-pdf in
 * #1404).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectForbiddenError,
  ProjectNotFoundError,
} from "@/lib/api-auth";

import {
  runGenerateCopy,
  defaultGenerateCopyServiceDeps,
} from "@/lib/generate-copy-service";
import type { GenerateCopyServiceDeps } from "@/lib/generate-copy-service";
import { requireUser } from "@/lib/test/require-user";

const ROOM_ID = "r" + "a".repeat(23) + "z";
const PROJECT_ID = "c" + "b".repeat(23) + "y";
const USER_ID = "user-1";

type Deps = GenerateCopyServiceDeps;

const makeRoomBasic = () => ({ id: ROOM_ID, projectId: PROJECT_ID });

const makeRoomFull = (overrides: Record<string, unknown> = {}) => ({
  id: ROOM_ID,
  name: "Living Room",
  rawDirectives: "Add warm lighting and a textured throw.",
  project: {
    stagingAesthetic: "Coastal",
    targetBuyer: "First-time coastal buyer",
    stagingDirectives: null,
    buyerDemographics: null,
  },
  ...overrides,
});

const makeDeps = (overrides: Partial<Deps> = {}): Deps => {
  const now = new Date("2026-10-20T12:00:00Z");
  const prismaStub = {
    room: {
      findFirst: vi.fn(async () => makeRoomBasic()),
      findUnique: vi.fn(async () => makeRoomFull()),
    },
  };
  const base: Deps = {
    getAuthedPrismaUser: requireUser({ id: USER_ID }).mockGetAuthedPrismaUser,
    requireProjectOwnershipOrThrow: vi.fn(async () => ({ ok: true as const, projectId: PROJECT_ID })),
    claimDailyQuota: vi.fn(async () =>
      ({
        claimed: true,
        allowed: true,
        used: 1,
        limit: 50,
        remaining: 49,
      }) as never
    ),
    refundDailyQuota: vi.fn(async () => undefined),
    resolveDailyLimit: vi.fn(() => 50),
    generateWithFailover: vi.fn(async <T,>(run: (model: unknown) => Promise<T>) => {
      const generation = await run("gpt-4o-mini");
      return {
        result: generation,
        modelId: "gpt-4o-mini",
        failedOver: false,
      };
    }) as unknown as Deps["generateWithFailover"],
    generateWithCircuitBreaker: vi.fn(async <T,>(fn: () => Promise<T>) => fn()) as unknown as Deps["generateWithCircuitBreaker"],
    generateObject: vi.fn(async () => ({
      object: {
        observedChallenge: "narrow footprint",
        recommendation: "layer warm neutrals",
        buyerPsychology: "aspirational calm",
        checklist: [
          { item: "linen drape", rationale: "softens the corner", category: "Textiles", priority: "Standard" },
          { item: "rattan accent", rationale: "textural warmth", category: "Accents", priority: "High" },
        ],
      },
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    })) as unknown as Deps["generateObject"],
    assertOpenAIConfigured: vi.fn(),
    saveRoomCopy: vi.fn(async () => ({ success: true as const })),
    prisma: prismaStub as unknown as Deps["prisma"],
    getEnv: vi.fn((name: string) => {
      if (name === "OPENAI_API_KEY") return "test-key";
      if (name === "DAILY_COPY_LIMIT") return "50";
      return undefined;
    }),
    now: () => now,
  };
  return { ...base, ...overrides };
};

const VALID_BODY = JSON.stringify({ roomId: ROOM_ID });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("defaultGenerateCopyServiceDeps", () => {
  it("exposes a real getEnv that reads from process.env", () => {
    const deps = defaultGenerateCopyServiceDeps();
    expect(typeof deps.getEnv).toBe("function");
    expect(typeof deps.getAuthedPrismaUser).toBe("function");
    expect(typeof deps.requireProjectOwnershipOrThrow).toBe("function");
    expect(typeof deps.claimDailyQuota).toBe("function");
    expect(typeof deps.refundDailyQuota).toBe("function");
    expect(typeof deps.resolveDailyLimit).toBe("function");
    expect(typeof deps.generateWithFailover).toBe("function");
    expect(typeof deps.generateWithCircuitBreaker).toBe("function");
    expect(typeof deps.generateObject).toBe("function");
    expect(typeof deps.saveRoomCopy).toBe("function");
    expect(typeof deps.now).toBe("function");
    expect(typeof deps.prisma).toBe("object");
  });
});

describe("runGenerateCopy body parsing", () => {
  it("returns invalidRequest when body is not JSON", async () => {
    const deps = makeDeps();
    const out = await runGenerateCopy({ bodyText: "not-json" }, deps!);
    expect(out).toMatchObject({ kind: "invalidRequest" });
    if (out.kind !== "invalidRequest") return;
    expect(out.message).toMatch(/JSON/);
  });

  it("returns invalidRequest when roomId is missing", async () => {
    const deps = makeDeps();
    const out = await runGenerateCopy(
      { bodyText: JSON.stringify({}) },
      deps!,
    );
    expect(out).toMatchObject({ kind: "invalidRequest" });
  });

  it("returns invalidRequest when roomId is empty", async () => {
    const deps = makeDeps();
    const out = await runGenerateCopy(
      { bodyText: JSON.stringify({ roomId: "" }) },
      deps!,
    );
    expect(out).toMatchObject({ kind: "invalidRequest" });
  });
});

describe("runGenerateCopy auth + ownership", () => {
  it("returns unauthorized when no user", async () => {
    const deps = makeDeps({
      getAuthedPrismaUser: vi.fn(async () => null),
    });
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out).toEqual({ kind: "unauthorized" });
  });

  it("returns roomNotFound when roomBasic is null", async () => {
    const deps = makeDeps({
      prisma: {
        room: {
          findFirst: vi.fn(async () => null),
          findUnique: vi.fn(async () => null),
        },
      } as unknown as Deps["prisma"],
    });
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out).toEqual({ kind: "roomNotFound" });
  });

  it("returns projectNotFound on ProjectNotFoundError", async () => {
    const deps = makeDeps({
      requireProjectOwnershipOrThrow: vi.fn(async () => {
        throw new ProjectNotFoundError(PROJECT_ID);
      }),
    });
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out).toEqual({ kind: "projectNotFound" });
  });

  it("returns projectForbidden on ProjectForbiddenError", async () => {
    const deps = makeDeps({
      requireProjectOwnershipOrThrow: vi.fn(async () => {
        throw new ProjectForbiddenError(PROJECT_ID);
      }),
    });
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out).toEqual({ kind: "projectForbidden" });
  });

  it("returns roomNotFound when full-room fetch is null after basic pass", async () => {
    const deps = makeDeps({
      prisma: {
        room: {
          findFirst: vi.fn(async () => makeRoomBasic()),
          findUnique: vi.fn(async () => null),
        },
      } as unknown as Deps["prisma"],
    });
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out).toEqual({ kind: "roomNotFound" });
  });

  it("returns missingDirectives when rawDirectives is empty/whitespace", async () => {
    const deps = makeDeps({
      prisma: {
        room: {
          findFirst: vi.fn(async () => makeRoomBasic()),
          findUnique: vi.fn(async () => makeRoomFull({ rawDirectives: "   " })),
        },
      } as unknown as Deps["prisma"],
    });
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out).toEqual({ kind: "missingDirectives" });
  });
});

describe("runGenerateCopy quota", () => {
  it("returns quotaExceeded with payload + claim when claim fails", async () => {
    const deps = makeDeps({
      claimDailyQuota: vi.fn(async () =>
        ({
          claimed: false,
          allowed: false,
          used: 50,
          limit: 50,
          resetsAt: "2026-10-21T00:00:00.000Z",
        }) as never
      ),
    });
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("quotaExceeded");
    if (out.kind !== "quotaExceeded") return;
    expect(out.claim.used).toBe(50);
    expect(out.payload.error).toBe("Daily limit reached");
  });

  it("calls claimDailyQuota with surface=copy, userId, limit, count=1, now", async () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const deps = makeDeps({ now: () => now });
    await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(deps!.claimDailyQuota).toHaveBeenCalledWith(
      "copy",
      USER_ID,
      50,
      1,
      now,
    );
  });

  it("resolves the daily copy limit with envValue + fallback", async () => {
    const deps = makeDeps({
      getEnv: vi.fn((name: string) => {
        if (name === "DAILY_COPY_LIMIT") return "10";
        if (name === "OPENAI_API_KEY") return "test-key";
        return undefined;
      }),
      resolveDailyLimit: vi.fn((_raw, fallback) =>
        typeof _raw === "string" && _raw.trim() !== "" ? Number(_raw) : fallback,
      ),
    });
    await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(deps!.resolveDailyLimit).toHaveBeenCalledWith("10", 50);
    expect(deps!.claimDailyQuota).toHaveBeenCalledWith(
      "copy",
      USER_ID,
      10,
      1,
      expect.any(Date),
    );
  });
});

describe("runGenerateCopy happy path", () => {
  it("returns success with copy, model, finishReason, usage, and no warnings when gate is silent", async () => {
    const deps = makeDeps();
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("success");
    if (out.kind !== "success") return;
    expect(out.generatedCopy.observedChallenge).toBe("narrow footprint");
    expect(out.generatedCopy.recommendation).toBe("layer warm neutrals");
    expect(out.generatedCopy.checklist).toHaveLength(2);
    expect(out.model).toBe("gpt-4o-mini");
    expect(out.finishReason).toBe("stop");
    expect(out.failedOver).toBe(false);
    expect(out.qualityWarnings).toEqual([]);
  });

  it("persists the copy via saveRoomCopy", async () => {
    const deps = makeDeps();
    await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(deps!.saveRoomCopy).toHaveBeenCalledWith(
      ROOM_ID,
      expect.objectContaining({
        observedChallenge: "narrow footprint",
        recommendation: "layer warm neutrals",
        buyerPsychology: "aspirational calm",
        checklist: expect.any(Array),
      }),
    );
  });

  it("returns saveFailed when saveRoomCopy returns success: false (keeps claim, no refund)", async () => {
    const deps = makeDeps({
      saveRoomCopy: vi.fn(async () => ({
        success: false as const,
        error: "db write failed",
      })),
    });
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("saveFailed");
    if (out.kind !== "saveFailed") return;
    expect(out.saveError).toBe("db write failed");
    expect(deps!.refundDailyQuota).not.toHaveBeenCalled();
  });
});

describe("runGenerateCopy quality gate (advisory)", () => {
  it("returns quality warnings from the gate alongside the copy", async () => {
    const generateObjectMock = vi.fn();
    generateObjectMock.mockResolvedValueOnce({
      object: {
        observedChallenge: "narrow footprint",
        recommendation: "layer warm neutrals",
        buyerPsychology: "aspirational calm",
        checklist: [
          { item: "linen drape", rationale: "softens the corner", category: "Textiles", priority: "Standard" },
          { item: "rattan accent", rationale: "textural warmth", category: "Accents", priority: "High" },
        ],
      },
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    generateObjectMock.mockResolvedValueOnce({
      object: {
        specificity: 2,
        buyer_aligned: undefined,
        checklist_actionable: undefined,
        aesthetic_consistent: undefined,
        qualityWarnings: [
          "aesthetic inconsistent: copy says 'industrial' but aesthetic is coastal",
        ],
      },
    });
    const deps = makeDeps({
      generateWithFailover: vi.fn(async (run: (m: unknown) => Promise<unknown>) => {
        const result = await run("gpt-4o-mini");
        return { result, modelId: "gpt-4o-mini", failedOver: false };
      }) as unknown as Deps["generateWithFailover"],
      generateWithCircuitBreaker: vi.fn(async <T,>(fn: () => Promise<T>) => fn()) as unknown as Deps["generateWithCircuitBreaker"],
      generateObject: generateObjectMock as unknown as Deps["generateObject"],
    });
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("success");
    if (out.kind !== "success") return;
    expect(out.qualityWarnings).toContain(
      "aesthetic inconsistent: copy says 'industrial' but aesthetic is coastal",
    );
  });

  it("swallows gate failures and adds a quality-gate-failed marker (success arm still returns)", async () => {
    const generateObjectMock = vi.fn();
    generateObjectMock.mockResolvedValueOnce({
      object: {
        observedChallenge: "narrow footprint",
        recommendation: "layer warm neutrals",
        buyerPsychology: "aspirational calm",
        checklist: [
          { item: "linen drape", rationale: "softens the corner", category: "Textiles", priority: "Standard" },
          { item: "rattan accent", rationale: "textural warmth", category: "Accents", priority: "High" },
        ],
      },
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    generateObjectMock.mockRejectedValueOnce(new Error("openai 503"));
    const deps = makeDeps({
      generateWithFailover: vi.fn(async (run: (m: unknown) => Promise<unknown>) => {
        const result = await run("gpt-4o-mini");
        return { result, modelId: "gpt-4o-mini", failedOver: false };
      }) as unknown as Deps["generateWithFailover"],
      generateWithCircuitBreaker: vi.fn(async <T,>(fn: () => Promise<T>) => fn()) as unknown as Deps["generateWithCircuitBreaker"],
      generateObject: generateObjectMock as unknown as Deps["generateObject"],
    });
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("success");
    if (out.kind !== "success") return;
    expect(
      out.qualityWarnings.some((w) => w.startsWith("quality-gate-failed:")),
    ).toBe(true);
  });
});

describe("runGenerateCopy refund policy (#1132)", () => {
  it("refunds the claimed unit when generateWithFailover throws (paid-call failure)", async () => {
    const deps = makeDeps({
      generateWithFailover: vi.fn(async () => {
        throw new Error("openai 503");
      }),
    });
    await expect(runGenerateCopy({ bodyText: VALID_BODY }, deps!)).rejects.toThrow(
      "openai 503",
    );
    expect(deps!.refundDailyQuota).toHaveBeenCalledWith("copy", USER_ID);
  });

  it("does NOT refund when saveRoomCopy returns success: false (generation resolved)", async () => {
    const deps = makeDeps({
      saveRoomCopy: vi.fn(async () => ({
        success: false as const,
        error: "save-fail",
      })),
    });
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("saveFailed");
    expect(deps!.refundDailyQuota).not.toHaveBeenCalled();
  });

  it("does NOT refund on happy path", async () => {
    const deps = makeDeps();
    const out = await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(out.kind).toBe("success");
    expect(deps!.refundDailyQuota).not.toHaveBeenCalled();
  });

  it("swallows refund failures so the route returns the original error", async () => {
    const deps = makeDeps({
      generateWithFailover: vi.fn(async () => {
        throw new Error("openai 503");
      }),
      refundDailyQuota: vi.fn(async () => {
        throw new Error("refund failed");
      }),
    });
    await expect(runGenerateCopy({ bodyText: VALID_BODY }, deps!)).rejects.toThrow(
      "openai 503",
    );
  });
});

describe("runGenerateCopy ownership checks", () => {
  it("calls requireProjectOwnershipOrThrow with the projectId from the basic fetch", async () => {
    const deps = makeDeps();
    await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(deps!.requireProjectOwnershipOrThrow).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ id: USER_ID }),
    );
  });
});

describe("runGenerateCopy fetch shape", () => {
  it("uses findFirst with id-only select for the basic existence check", async () => {
    const findFirst = vi.fn(async () => makeRoomBasic());
    const findUnique = vi.fn(async () => makeRoomFull());
    const deps = makeDeps({
      prisma: {
        room: { findFirst, findUnique },
      } as unknown as Deps["prisma"],
    });
    await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: ROOM_ID },
      select: { id: true, projectId: true },
    });
  });

  it("uses findUnique with project include for the full fetch", async () => {
    const findUnique = vi.fn(async () => makeRoomFull());
    const deps = makeDeps({
      prisma: {
        room: {
          findFirst: vi.fn(async () => makeRoomBasic()),
          findUnique,
        },
      } as unknown as Deps["prisma"],
    });
    await runGenerateCopy({ bodyText: VALID_BODY }, deps!);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: ROOM_ID },
      include: {
        project: {
          select: {
            stagingAesthetic: true,
            targetBuyer: true,
            stagingDirectives: true,
            buyerDemographics: true,
          },
        },
      },
    });
  });
});