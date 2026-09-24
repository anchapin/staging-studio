import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateWithRetry, isRetryableError } from "@/lib/ai";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from "ai";

const mockedGenerateObject = vi.mocked(generateObject);

describe("generateWithRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return result on first call when successful", async () => {
    const mockResult = { object: { test: "data" }, finishReason: "stop" as const, usage: {} };
    mockedGenerateObject.mockResolvedValue(mockResult as never);

    const result = await generateWithRetry({
      model: "gpt-4o-mini",
      prompt: "test",
    });

    expect(result).toEqual(mockResult);
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("should retry on rate limit error and succeed on second attempt", async () => {
    const rateLimitError = new Error("rate_limit_exceeded: Rate limit exceeded");
    const successResult = { object: { test: "data" }, finishReason: "stop" as const, usage: {} };

    mockedGenerateObject
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(successResult as never);

    const result = await generateWithRetry(
      { model: "gpt-4o-mini", prompt: "test" },
      { maxRetries: 3 }
    );

    expect(result).toEqual(successResult);
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
  });

  it("should retry on server error (500) and succeed on third attempt", async () => {
    const serverError = new Error("Internal server error: 500");
    const successResult = { object: { test: "data" }, finishReason: "stop" as const, usage: {} };

    mockedGenerateObject
      .mockRejectedValueOnce(serverError)
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(successResult as never);

    const result = await generateWithRetry(
      { model: "gpt-4o-mini", prompt: "test" },
      { maxRetries: 3 }
    );

    expect(result).toEqual(successResult);
    expect(mockedGenerateObject).toHaveBeenCalledTimes(3);
  });

  it("should retry on timeout error", async () => {
    const timeoutError = new Error("Request timeout exceeded");
    const successResult = { object: { test: "data" }, finishReason: "stop" as const, usage: {} };

    mockedGenerateObject
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(successResult as never);

    const result = await generateWithRetry(
      { model: "gpt-4o-mini", prompt: "test" },
      { maxRetries: 3 }
    );

    expect(result).toEqual(successResult);
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
  });

  it("should throw immediately on non-retryable error", async () => {
    const authError = new Error("Authentication failed: Invalid API key");

    mockedGenerateObject.mockRejectedValue(authError);

    await expect(
      generateWithRetry({ model: "gpt-4o-mini", prompt: "test" })
    ).rejects.toThrow("Authentication failed: Invalid API key");

    expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("should respect max retries and throw after exhausting retries", async () => {
    const rateLimitError = new Error("rate_limit_exceeded: Rate limit exceeded");

    mockedGenerateObject.mockRejectedValue(rateLimitError);

    await expect(
      generateWithRetry(
        { model: "gpt-4o-mini", prompt: "test" },
        { maxRetries: 2 }
      )
    ).rejects.toThrow("rate_limit_exceeded: Rate limit exceeded");

    expect(mockedGenerateObject).toHaveBeenCalledTimes(3);
  });

  it("should apply exponential backoff with jitter", async () => {
    const rateLimitError = new Error("rate_limit_exceeded: Rate limit exceeded");
    const successResult = { object: { test: "data" }, finishReason: "stop" as const, usage: {} };

    mockedGenerateObject
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(successResult as never);

    const startTime = Date.now();
    const result = await generateWithRetry(
      { model: "gpt-4o-mini", prompt: "test" },
      { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 10000 }
    );
    const elapsed = Date.now() - startTime;

    expect(result).toEqual(successResult);
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeGreaterThanOrEqual(1000);
  });
});

describe("isRetryableError", () => {
  it("should return true for rate limit errors", () => {
    expect(isRetryableError(new Error("rate_limit_exceeded"))).toBe(true);
    expect(isRetryableError(new Error("429"))).toBe(true);
  });

  it("should return true for server errors", () => {
    expect(isRetryableError(new Error("500 Internal Server Error"))).toBe(true);
    expect(isRetryableError(new Error("502 Bad Gateway"))).toBe(true);
    expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isRetryableError(new Error("504 Gateway Timeout"))).toBe(true);
  });

  it("should return true for timeout errors", () => {
    expect(isRetryableError(new Error("Request timeout exceeded"))).toBe(true);
  });

  it("should return true for network errors", () => {
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
    expect(isRetryableError(new Error("Network error"))).toBe(true);
  });

  it("should return false for auth errors", () => {
    expect(isRetryableError(new Error("Authentication failed"))).toBe(false);
    expect(isRetryableError(new Error("Invalid API key"))).toBe(false);
  });

  it("should return false for generic errors", () => {
    expect(isRetryableError(new Error("Something went wrong"))).toBe(false);
  });

  it("should return false for non-Error inputs", () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError("error string")).toBe(false);
  });
});
