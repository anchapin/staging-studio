import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry } from "@/lib/retry";

describe("withRetry", () => {
  // Spy on setTimeout to control time
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setTimeoutSpy = vi.spyOn(global, "setTimeout");
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
  });

  it("(a) succeeds on first attempt with no retries", async () => {
    const mockFn = vi.fn().mockResolvedValue("success");

    const result = await withRetry(mockFn, 3);

    expect(result).toBe("success");
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("(b) transient failure then success within retry limit", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("success");

    const result = await withRetry(mockFn, 3);

    expect(result).toBe("success");
    expect(mockFn).toHaveBeenCalledTimes(2);
    // Should have waited once before the retry
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  it("(c) permanent failure after exhausting retries", async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error("permanent"));

    await expect(withRetry(mockFn, 3)).rejects.toThrow("permanent");
    expect(mockFn).toHaveBeenCalledTimes(3);
    // Should have waited twice (after attempt 1 and attempt 2, before attempts 2 and 3)
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
  });

  it("(d) exponential delay growth — each retry delay is longer than the previous", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("success");

    // Manually control setTimeout to capture delays
    const delays: number[] = [];
    setTimeoutSpy.mockImplementation((callback: () => void, delayMs: number) => {
      delays.push(delayMs);
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    await withRetry(mockFn, 3, 1000, 30000);

    expect(delays.length).toBe(2);
    // delay[0] is for attempt 1 -> retry (base 1000 * 2^0 = 1000)
    // delay[1] is for attempt 2 -> retry (base 1000 * 2^1 = 2000)
    // With ±500ms jitter, delay[0] ∈ [500, 1500] and delay[1] ∈ [1500, 2500]
    // Each subsequent delay should be longer than the previous
    expect(delays[1]).toBeGreaterThan(delays[0]);
  });

  it("(e) capped at maxDelayMs", async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("success");

    const delays: number[] = [];
    setTimeoutSpy.mockImplementation((callback: () => void, delayMs: number) => {
      delays.push(delayMs);
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    // Use a maxDelay of 5000ms — with exponential growth, later attempts
    // would exceed this and should be capped
    await withRetry(mockFn, 5, 1000, 5000);

    // All delays should be <= 5000
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(5000);
    }
    // Last delay before success should be close to 5000 (capped)
    expect(delays[delays.length - 1]).toBeGreaterThan(4000);
  });

  it("(f) maxAttempts=1 — no retries, fails immediately", async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(withRetry(mockFn, 1)).rejects.toThrow("fail");
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("(g) maxAttempts=1 — succeeds on first try", async () => {
    const mockFn = vi.fn().mockResolvedValue("immediate success");

    const result = await withRetry(mockFn, 1);

    expect(result).toBe("immediate success");
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("(h) error is preserved — thrown error is the last error from fn", async () => {
    const lastError = new Error("final failure");
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockRejectedValueOnce(new Error("third"))
      .mockRejectedValue(lastError);

    // Advance time automatically when setTimeout is called
    setTimeoutSpy.mockImplementation((callback: () => void) => {
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    await expect(withRetry(mockFn, 4)).rejects.toThrow(lastError);
    expect(mockFn).toHaveBeenCalledTimes(4);
  });
});
