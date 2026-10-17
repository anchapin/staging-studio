import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InferenceRequestGoneError } from "@/lib/inference";
import { submitWithRetry } from "@/lib/inpaint-submit";

// #1201: a one-off 404 from the provider's submit endpoint should be
// retried once with the same payload instead of failing the user's
// click (and inviting a second billed job).

const MODEL = "flux-fill";
const PAYLOAD = { input: { prompt: "vintage modern sofa", image_url: "https://x/y.png" } };

function gone(provider: "fal" | "replicate" = "fal") {
  return new InferenceRequestGoneError(provider, 404);
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submitWithRetry — InferenceRequestGoneError (#1201)", () => {
  it("resolves to the second call's result after a 404 on the first", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(gone())
      .mockResolvedValueOnce({ request_id: "req-2" });

    await expect(submitWithRetry(submit, MODEL, PAYLOAD)).resolves.toEqual({
      request_id: "req-2",
    });
    expect(submit).toHaveBeenCalledTimes(2);
    // Same model and same payload object on the resend.
    expect(submit.mock.calls[1]).toEqual([MODEL, PAYLOAD]);
  });

  it("propagates the second call's 404 as-is", async () => {
    const second = gone("replicate");
    const submit = vi.fn().mockRejectedValueOnce(gone()).mockRejectedValueOnce(second);

    await expect(submitWithRetry(submit, MODEL, PAYLOAD)).rejects.toBe(second);
  });

  it("caps at exactly one retry when every attempt 404s", async () => {
    const submit = vi.fn().mockRejectedValue(gone());

    await expect(submitWithRetry(submit, MODEL, PAYLOAD)).rejects.toBeInstanceOf(
      InferenceRequestGoneError
    );
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("does not wait before the 404 retry", async () => {
    vi.useFakeTimers();
    try {
      const submit = vi
        .fn()
        .mockRejectedValueOnce(gone())
        .mockResolvedValueOnce({ request_id: "req-3" });
      // Resolves without advancing timers, so no backoff sleep happened.
      await expect(submitWithRetry(submit, MODEL, PAYLOAD)).resolves.toEqual({
        request_id: "req-3",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("still does not retry auth errors", async () => {
    const authError = Object.assign(new Error("Unauthorized"), { status: 401 });
    const submit = vi.fn().mockRejectedValue(authError);

    await expect(submitWithRetry(submit, MODEL, PAYLOAD)).rejects.toBe(authError);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
