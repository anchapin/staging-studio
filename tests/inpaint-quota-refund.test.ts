/**
 * Issue #1421 — the central quota-release helper.
 *
 * `releaseInpaintQuotaReservation` is the SINGLE place an inpaint
 * daily-quota reservation is given back to the user. This suite pins
 * its contract:
 *
 * - a row that produced NO durable result releases its reservation;
 * - a row that already means "released" (ERROR / PERSISTENCE_FAILED /
 *   COMPLETED) is NOT refunded again (no double refund);
 * - an unknown previous status is treated as "not yet released".
 *
 * The suite is deliberately dependency-light: `@/lib/inpaint-submit`
 * (which owns `refundInpaintQuota`) and `@/lib/prisma` are mocked, so
 * no database and no generated Prisma client are needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  refundInpaintQuota: vi.fn(),
  rowUpdate: vi.fn(),
  getInferenceClient: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inpaintRequest: {
      update: (...args: unknown[]) => mock.rowUpdate(...args),
    },
  },
}));

vi.mock("@/lib/inpaint-submit", () => ({
  refundInpaintQuota: (...args: unknown[]) => mock.refundInpaintQuota(...args),
}));

vi.mock("@/lib/inference", () => ({
  getInferenceClient: (...args: unknown[]) => mock.getInferenceClient(...args),
  LOGICAL_MODEL: { FLUX_FILL: "fal-ai/flux-lora-fill" },
}));

import {
  cancelInpaintProviderJob,
  isTransientDbWriteError,
  releaseInpaintQuotaReservation,
  writeInpaintProviderJobIdWithRetry,
} from "@/lib/inpaint-quota";

const USER_ID = "user-1421";
const REQUEST_ID = "req-1421";

beforeEach(() => {
  mock.refundInpaintQuota.mockReset();
  mock.rowUpdate.mockReset();
  mock.getInferenceClient.mockReset();
  mock.refundInpaintQuota.mockResolvedValue(undefined);
  mock.rowUpdate.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("releaseInpaintQuotaReservation — release (issue #1421)", () => {
  it("releases the reservation for a row that produced no durable result", async () => {
    const result = await releaseInpaintQuotaReservation({
      userId: USER_ID,
      requestId: REQUEST_ID,
      reason: "provider_submit_failed",
      previousStatus: "IN_QUEUE",
    });

    expect(mock.refundInpaintQuota).toHaveBeenCalledTimes(1);
    expect(mock.refundInpaintQuota).toHaveBeenCalledWith(USER_ID);
    expect(result).toEqual({
      refunded: true,
      skipped: false,
      reason: "provider_submit_failed",
    });
  });

  it("releases the reservation when the previous status is unknown", async () => {
    const result = await releaseInpaintQuotaReservation({
      userId: USER_ID,
      requestId: REQUEST_ID,
      reason: "provider_job_unreachable",
    });

    expect(mock.refundInpaintQuota).toHaveBeenCalledTimes(1);
    expect(result.refunded).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it.each(["ERROR", "PERSISTENCE_FAILED", "COMPLETED"])(
    "does NOT release twice when the row is already in %s",
    async (previousStatus) => {
      const result = await releaseInpaintQuotaReservation({
        userId: USER_ID,
        requestId: REQUEST_ID,
        reason: "provider_reported_error",
        previousStatus,
      });

      expect(mock.refundInpaintQuota).not.toHaveBeenCalled();
      expect(result).toEqual({
        refunded: false,
        skipped: true,
        reason: "provider_reported_error",
      });
    }
  );

  it("releases for every audited failure reason", async () => {
    const reasons = [
      "provider_submit_failed",
      "post_submit_record_write_failed",
      "provider_job_unreachable",
      "provider_reported_error",
      "persistence_failed",
    ] as const;

    for (const reason of reasons) {
      mock.refundInpaintQuota.mockClear();
      const result = await releaseInpaintQuotaReservation({
        userId: USER_ID,
        requestId: REQUEST_ID,
        reason,
        previousStatus: "IN_QUEUE",
      });
      expect(mock.refundInpaintQuota, `reason ${reason}`).toHaveBeenCalledTimes(1);
      expect(result.refunded, `reason ${reason}`).toBe(true);
    }
  });

  it("records a provider-cost write-off when the upstream job could not be cancelled", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await releaseInpaintQuotaReservation({
      userId: USER_ID,
      requestId: REQUEST_ID,
      reason: "post_submit_record_write_failed",
      previousStatus: "IN_QUEUE",
      providerJobId: "provider-job-1",
      providerCostIncurred: true,
      providerCancelSucceeded: false,
    });

    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("inpaint_quota_reservation_released");
    expect(logged).toContain('"providerCostWriteOff":true');
    expect(mock.refundInpaintQuota).toHaveBeenCalledTimes(1);
  });
});

describe("isTransientDbWriteError — issue #1421 path 3 retry policy", () => {
  it("treats transient Prisma codes as retryable", () => {
    expect(isTransientDbWriteError({ code: "P2034" })).toBe(true);
    expect(isTransientDbWriteError({ code: "P2028" })).toBe(true);
  });

  it("treats socket-level codes as retryable", () => {
    expect(isTransientDbWriteError({ code: "ECONNRESET" })).toBe(true);
    expect(isTransientDbWriteError({ code: "ETIMEDOUT" })).toBe(true);
  });

  it("treats permanent Prisma codes as non-retryable", () => {
    expect(isTransientDbWriteError({ code: "P2002" })).toBe(false);
  });

  it("treats a deadlock message as retryable", () => {
    expect(isTransientDbWriteError(new Error("deadlock detected"))).toBe(true);
  });
});

describe("writeInpaintProviderJobIdWithRetry — issue #1421 path 3", () => {
  it("retries a transient write failure and succeeds", async () => {
    mock.rowUpdate
      .mockRejectedValueOnce(Object.assign(new Error("write conflict"), { code: "P2034" }))
      .mockResolvedValueOnce({});

    await writeInpaintProviderJobIdWithRetry({
      requestId: REQUEST_ID,
      providerJobId: "provider-job-1",
    });

    expect(mock.rowUpdate).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent write failure", async () => {
    mock.rowUpdate.mockRejectedValue(
      Object.assign(new Error("unique constraint failed"), { code: "P2002" })
    );

    await expect(
      writeInpaintProviderJobIdWithRetry({
        requestId: REQUEST_ID,
        providerJobId: "provider-job-1",
      })
    ).rejects.toThrow("unique constraint failed");

    expect(mock.rowUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("cancelInpaintProviderJob — issue #1421 path 3", () => {
  it("reports 'no cancel method' when the provider client has none", async () => {
    mock.getInferenceClient.mockResolvedValue({ submit: vi.fn() });

    const outcome = await cancelInpaintProviderJob("provider-job-1");

    expect(outcome.attempted).toBe(true);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.reason).toBe("provider_client_has_no_cancel_method");
  });

  it("reports the provider's own cancel outcome when a cancel method exists", async () => {
    const cancel = vi.fn(async () => ({ cancelled: true, reason: "cancelled upstream" }));
    mock.getInferenceClient.mockResolvedValue({ cancel });

    const outcome = await cancelInpaintProviderJob("provider-job-1");

    expect(cancel).toHaveBeenCalledWith("fal-ai/flux-lora-fill", "provider-job-1");
    expect(outcome.cancelled).toBe(true);
  });

  it("never throws when the cancel call blows up", async () => {
    mock.getInferenceClient.mockResolvedValue({
      cancel: vi.fn(async () => {
        throw new Error("provider down");
      }),
    });

    const outcome = await cancelInpaintProviderJob("provider-job-1");

    expect(outcome.cancelled).toBe(false);
    expect(outcome.reason).toContain("provider_cancel_failed");
  });
});
