import { describe, it, expect, vi } from "vitest";
import { withRetry } from "@/lib/retry";

// Mock the circuit breaker module
vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitBreaker: vi.fn(() => ({
    execute: vi.fn((fn) => fn()),
  })),
}));

describe("AI retry behavior", () => {
  it("withRetry is called on retryable failures", async () => {
    let attempts = 0;
    const retryableError = new Error("Temporary failure");

    const mockFn = vi.fn().mockImplementation(() => {
      attempts++;
      if (attempts < 3) {
        throw retryableError;
      }
      return "success";
    });

    const result = await withRetry(mockFn, 5, 100, 1000);

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("withRetry throws after max attempts exhausted", async () => {
    const permanentError = new Error("Permanent failure");

    const mockFn = vi.fn().mockImplementation(() => {
      throw permanentError;
    });

    await expect(withRetry(mockFn, 3, 50, 500)).rejects.toThrow(
      "Permanent failure"
    );
    // Should have tried 3 times (initial + 2 retries)
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it("withRetry succeeds on first attempt", async () => {
    const mockFn = vi.fn().mockResolvedValue("immediate success");

    const result = await withRetry(mockFn, 5, 100, 1000);

    expect(result).toBe("immediate success");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});
