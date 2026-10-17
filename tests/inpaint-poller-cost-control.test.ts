/**
 * Inpaint poller cost-control regressions (#1141, #1142, #1135).
 *
 * Each case guards a path where the client used to submit a second
 * billed fal job for work that was still in flight, or already lost.
 */
import { describe, expect, it, vi } from "vitest";

import {
  classifyStatusResponse,
  InpaintPollError,
  pollInpaintStatus,
  type FetchInpaintStatus,
} from "@/lib/inpaint-polling";
import { InpaintJobLostError, resolveInpaintRetry } from "@/lib/inpaint-retry";

describe("issue #1142 — a 429 is transient, never terminal", () => {
  it("classifies 429 as retryable when the body carries retryable: true", () => {
    expect(
      classifyStatusResponse(false, 429, {
        message: "Rate limit exceeded. Please wait 12 seconds before trying again.",
        retryable: true,
      })
    ).toEqual({
      kind: "retryable",
      message: "Rate limit exceeded. Please wait 12 seconds before trying again.",
    });
  });

  it("classifies 429 as retryable even when the body omits the flag", () => {
    // An older deploy, or a proxy that rewrites the body, must not push
    // the client onto the resubmit path and bill a second fal job.
    expect(classifyStatusResponse(false, 429, { message: "Too many requests" })).toEqual({
      kind: "retryable",
      message: "Too many requests",
    });
  });

  it("still treats other 4xx without the flag as terminal", () => {
    expect(classifyStatusResponse(false, 404, { message: "Request not found" })).toEqual({
      kind: "terminal",
      message: "Request not found",
    });
  });
});

describe("issue #1141 — the production poll honours its own bounds", () => {
  it("sleeps with growing backoff between transport failures instead of spinning", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let calls = 0;
    const fetchStatus: FetchInpaintStatus = vi.fn(async () => {
      calls += 1;
      if (calls <= 3) throw new Error("network down");
      return {
        ok: true,
        httpStatus: 200,
        body: {
          status: "completed",
          imageUrl: "https://demo.supabase.co/storage/v1/object/public/out.png",
        },
      };
    });

    const result = await pollInpaintStatus(fetchStatus, "req-1", {
      intervalMs: 1000,
      maxIntervalMs: 30_000,
      maxAttempts: 30,
      maxWaitMs: 5 * 60_000,
      sleep,
    });

    expect(result.imageUrl).toBe(
      "https://demo.supabase.co/storage/v1/object/public/out.png"
    );
    // One sleep per failed attempt, each longer than the last — the old
    // loop did a bare `continue` and burned every attempt in millis.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
  });

  it("stops at maxWaitMs rather than running on to maxAttempts", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    // startedAt, then a clock already past the 5 minute budget.
    nowSpy.mockReturnValueOnce(0).mockReturnValue(5 * 60_000 + 1);

    const fetchStatus: FetchInpaintStatus = vi.fn();

    await expect(
      pollInpaintStatus(fetchStatus, "req-2", {
        maxAttempts: 30,
        maxWaitMs: 5 * 60_000,
        sleep: async () => {},
      })
    ).rejects.toMatchObject({ reason: "timeout" });

    expect(fetchStatus).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});

describe("issue #1135 — a lost job is never retried", () => {
  it("is not retryable and says the user was charged once", () => {
    const error = new InpaintJobLostError();
    expect(error.retryable).toBe(false);
    expect(error.name).toBe("InpaintJobLostError");
    expect(error.message).toMatch(/charged once/i);
  });

  it("is not an InpaintPollError, so it never resumes a requestId that has no row", () => {
    const error = new InpaintJobLostError();
    expect(error).not.toBeInstanceOf(InpaintPollError);
    // The caller short-circuits before this, but the decision core must
    // not claim there is something pollable either way.
    expect(resolveInpaintRetry(error, null)).toEqual({ kind: "resubmit" });
  });
});
