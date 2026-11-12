/**
 * Seam test: real provider dispatch vs. the segment capability gate (#1527).
 *
 * Issue #1527: the segment-furnishings surface defaults to
 * `LOGICAL_MODEL.SAM_3_1_IMAGE`, but NEITHER wired inference provider
 * implements it (`resolveAlibabaModel` in `lib/alibaba-adapter.ts` and
 * `resolveOpenAiModel` in `lib/openai-adapter.ts` both throw "unknown
 * logical model"). Before the fix every request claimed a daily quota
 * unit, passed `assertInferenceConfigured()`, and then died in provider
 * dispatch as an opaque 500 — the user paid for a call that could never
 * succeed.
 *
 * This file pins the fix at the SEAM between the real provider dispatch
 * and the route, in the style of `tests/alibaba-seam.test.ts`:
 *
 *   1. The REAL `getInferenceClient()` (from `lib/inference.ts`) is
 *      exercised against `LOGICAL_MODEL.SAM_3_1_IMAGE`. Only the outer
 *      network `fetch` is stubbed — `@/lib/inference` is NEVER mocked, so
 *      the real adapter is the thing under test. This proves the truth of
 *      the capability table: the wired adapters really cannot dispatch
 *      SAM 3.1, so failing fast is honest, not a guess.
 *   2. The route (real inference module included) is driven end to end:
 *      the request must fail with a CLASSIFIED unsupported-model error
 *      (501, `retryable: false`) and `claimDailyQuota` must NEVER run —
 *      no quota unit may be spent on a call that cannot succeed.
 *
 * The capability table (`WIRED_PROVIDER_LOGICAL_MODELS` in
 * `lib/segment-furnishings-service.ts`) is read dynamically so this file
 * fails as an ASSERTION on the pre-fix tree rather than as an import
 * error: the pre-fix tree has no such export, and the route there claims
 * quota before it fails.
 *
 * No network, no paid calls: dummy env keys + a stubbed `fetch` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks. Note what is NOT mocked: `@/lib/inference`. The real provider
// dispatch is the subject of this file.
// ---------------------------------------------------------------------------

const mockClaimDailyQuota = vi.hoisted(() =>
  vi.fn(async () => ({
    claimed: true,
    allowed: true,
    used: 1,
    limit: 100,
    remaining: 99,
  })),
);
const mockRefundDailyQuota = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/api-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-quota")>();
  return {
    ...actual,
    claimDailyQuota: mockClaimDailyQuota,
    refundDailyQuota: mockRefundDailyQuota,
  };
});

vi.mock("@/lib/api-auth", () => ({
  getAuthedPrismaUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { room: { findFirst: vi.fn() } },
}));

const MOCK_USER_ID = "cuser12345678901234567890";
const MOCK_ROOM_ID = "croom12345678901234567890";

const ORIGINAL_ENV = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => {
    throw new Error(
      "the seam test must never reach the network: SAM 3.1 has no wired provider",
    );
  });
  vi.stubGlobal("fetch", fetchMock);

  process.env.INFERENCE_PROVIDER = "alibaba";
  process.env.ALIBABA_DASHSCOPE_API_KEY = "<redacted>";
  process.env.ALIBABA_BAILIAN_WORKSPACE_ID = "llm-test-workspace";
  process.env.ALIBABA_INPAINT_MODEL = "qwen-image-2.1-pro";
  process.env.OPENAI_API_KEY = "<redacted>";

  const { getAuthedPrismaUser } = await import("@/lib/api-auth");
  vi.mocked(getAuthedPrismaUser).mockResolvedValue({
    id: MOCK_USER_ID,
    email: "test@example.com",
  } as never);

  const { prisma } = await import("@/lib/prisma");
  vi.mocked(prisma.room.findFirst).mockResolvedValue({
    id: MOCK_ROOM_ID,
    projectId: "cproject1234567890123456",
    afterImageUrl: null,
  } as never);

  // The inference client is cached at module level; reset it so each
  // test resolves the provider it configured.
  const inference = await import("@/lib/inference");
  inference._resetInferenceClientForTests();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

function buildRequest(): NextRequest {
  return {
    url: "http://localhost/api/segment/furnishings",
    json: async () => ({
      roomId: MOCK_ROOM_ID,
      imageUrl: "https://demo.supabase.co/storage/v1/object/public/room-photos/room.jpg",
      concept: "sofa",
    }),
  } as unknown as NextRequest;
}

describe("SAM 3.1 fail-fast seam (issue #1527)", () => {
  describe("real provider dispatch (only `fetch` is stubbed)", () => {
    it("the wired alibaba adapter cannot dispatch sam-3-1-image", async () => {
      const { getInferenceClient, LOGICAL_MODEL } = await import("@/lib/inference");

      const client = await getInferenceClient();
      await expect(
        client.subscribe(LOGICAL_MODEL.SAM_3_1_IMAGE, {
          input: { image_url: "https://example.test/room.jpg", prompt: "sofa" },
          abortSignal: new AbortController().signal,
        }),
      ).rejects.toThrow(/unknown logical model/i);

      // The adapter rejects the logical model BEFORE any network call.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("the wired openai adapter cannot dispatch sam-3-1-image", async () => {
      process.env.INFERENCE_PROVIDER = "openai";
      const inference = await import("@/lib/inference");
      inference._resetInferenceClientForTests();

      const { getInferenceClient, LOGICAL_MODEL } = inference;
      const client = await getInferenceClient();
      await expect(
        client.subscribe(LOGICAL_MODEL.SAM_3_1_IMAGE, {
          input: { imageUrl: "https://example.test/room.jpg", prompt: "sofa" },
          abortSignal: new AbortController().signal,
        }),
      ).rejects.toThrow(/unknown logical model/i);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("the capability table matches the real dispatch (only flux-fill is wired)", async () => {
      // Read dynamically: on the pre-fix tree this export does not exist,
      // so the assertion below fails (instead of the module failing to
      // import) and the failure message points at the real gap.
      const service = (await import(
        "@/lib/segment-furnishings-service"
      )) as unknown as {
        WIRED_PROVIDER_LOGICAL_MODELS?: Record<string, readonly string[]>;
      };
      const table = service.WIRED_PROVIDER_LOGICAL_MODELS;

      expect(table).toBeDefined();
      expect(table?.alibaba).toEqual(["flux-fill"]);
      expect(table?.openai).toEqual(["flux-fill"]);
      // The model this surface needs must NOT be listed as supported.
      expect(table?.alibaba).not.toContain("sam-3-1-image");
      expect(table?.openai).not.toContain("sam-3-1-image");
    });
  });

  describe("route seam (classified failure, no quota claim)", () => {
    it("returns a classified 501 unsupported-model error and never claims quota", async () => {
      const { POST } = await import("@/app/api/segment/furnishings/route");

      const response = await POST(buildRequest());
      const body = await response.json();

      // 501 Not Implemented: the provider cannot implement the model, so
      // the failure is classified, not an opaque 500.
      expect(response.status).toBe(501);
      expect(body.code).toBe("segmentation-failed");
      expect(body.retryable).toBe(false);
      expect(body.error).toBe("Furnishings detection unavailable");
      expect(String(body.message)).toMatch(/SAM 3\.1/i);

      // The heart of the fix: no quota unit is spent on a call that is
      // guaranteed to fail in provider dispatch.
      expect(mockClaimDailyQuota).not.toHaveBeenCalled();
      // Nothing was claimed, so nothing may be refunded either.
      expect(mockRefundDailyQuota).not.toHaveBeenCalled();
      // And no provider request went out.
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
