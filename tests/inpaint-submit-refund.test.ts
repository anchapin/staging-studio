/**
 * Issue #1421 third unrefunded path — when the upstream provider
 * billed DashScope (or the fal queue) but the row-create failed,
 * the user is left holding a billed job with no `InpaintRequest`
 * row to refer back to. The orphan-recovery scripts can only fix
 * *existing* rows, so the user had no recourse before this fix:
 * `submitInpaintRequest` now refund-on-record-failure so the
 * firm-internal daily-quota counter mirrors the user's visible
 * state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  inferenceSubmit: vi.fn(),
  recordCreate: vi.fn(),
  recordUpsert: vi.fn(),
  refund: vi.fn(),
}));

vi.mock("@/lib/inference", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inference")>();
  return {
    ...actual,
    assertInferenceConfigured: vi.fn(),
    getInferenceClient: vi.fn(async () => ({
      subscribe: vi.fn(),
      submit: (...args: unknown[]) => mock.inferenceSubmit(...args),
      status: vi.fn(),
      result: vi.fn(),
    })),
  };
});

// `submitWithRetry` lives inside `inpaint-submit.ts` itself, so we
// let the wrapper call through to `mock.inferenceSubmit` via the
// mocked inference client. It exercises the same retry logic as the
// route-level tests in tests/inpaint-submit-route.test.ts.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyApiUsage: {
      findUnique: vi.fn(async () => null),
      upsert: (...args: unknown[]) => mock.recordUpsert(...args),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    inpaintRequest: {
      count: vi.fn(async () => 0),
      create: (...args: unknown[]) => mock.recordCreate(...args),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/inpaint-quality-gate", () => ({
  evaluateInpaintQualityGate: vi.fn(async () => []),
  INPAINT_QUALITY_GATE_RETRIES: 1,
}));

vi.mock("@/lib/api-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-quota")>();
  return {
    ...actual,
    refundDailyQuota: (...args: unknown[]) => mock.refund(...args),
  };
});

import { submitInpaintRequest } from "@/lib/inpaint-submit";

const ROOM = {
  id: "room-1",
  name: "Living Room",
  userId: "user-1",
  projectId: "project-1",
  afterImageUrl: "https://example.com/after1.png",
  afterImageUrl2: "https://example.com/after2.png",
};

const PARAMS = {
  userId: "user-1",
  imageUrl: "https://example.com/in.png",
  maskUrl: "https://example.com/mask.png",
  aesthetic: "Modern Farmhouse",
  promptDirectives: "warm wood tones",
  strength: 0.65,
  seed: 42,
  variantSlot: 0,
  sourceSlot: 0,
};

beforeEach(() => {
  mock.inferenceSubmit.mockReset();
  mock.recordCreate.mockReset();
  mock.recordUpsert.mockReset();
  mock.refund.mockReset();

  mock.recordUpsert.mockResolvedValue({ count: 1 });
  mock.refund.mockResolvedValue(undefined);

  mock.inferenceSubmit.mockResolvedValue({
    request_id: "req-abc",
    result: { imageUrl: "https://example.com/out.png" },
  });
  mock.recordCreate.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submitInpaintRequest — refund on orphan-write (#1421)", () => {
  it("refunds once when row-create fails after a successful charge", async () => {
    mock.recordCreate.mockImplementation(async () => {
      throw new Error("row-down");
    });

    const result = await submitInpaintRequest(ROOM, PARAMS);

    expect(result.quotaChargeDegraded).toBe(false);
    expect(result.recordDegraded).toBe(true);
    expect(mock.refund).toHaveBeenCalledTimes(1);
  });

  it("refunds once when both quota-charge and row-create fail", async () => {
    mock.recordUpsert.mockImplementation(async () => {
      throw new Error("charge-down");
    });
    mock.recordCreate.mockImplementation(async () => {
      throw new Error("row-down");
    });

    const result = await submitInpaintRequest(ROOM, PARAMS);

    expect(result.quotaChargeDegraded).toBe(true);
    expect(result.recordDegraded).toBe(true);
    // Charge-side refund fires first; record-side refund is gated
    // by `if (!quotaChargeDegraded)` so the counter does not dip
    // by 2 for one billed-and-undelivered unit.
    expect(mock.refund).toHaveBeenCalledTimes(1);
  });

  it("refunds once when charge-write fails (record-create not reached)", async () => {
    mock.recordUpsert.mockImplementation(async () => {
      throw new Error("charge-down");
    });

    const result = await submitInpaintRequest(ROOM, PARAMS);

    expect(result.quotaChargeDegraded).toBe(true);
    expect(result.recordDegraded).toBe(false);
    expect(mock.refund).toHaveBeenCalledTimes(1);
  });

  it("does not refund when both the charge and the row write succeed", async () => {
    const result = await submitInpaintRequest(ROOM, PARAMS);

    expect(result.quotaChargeDegraded).toBe(false);
    expect(result.recordDegraded).toBe(false);
    expect(mock.refund).not.toHaveBeenCalled();
  });
});
