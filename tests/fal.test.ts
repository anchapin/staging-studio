import { describe, expect, it, vi, beforeEach } from "vitest";

import { assertFalConfigured, falSubscribeWithCircuitBreaker } from "@/lib/fal";
import { MissingEnvVarsError } from "@/lib/env";

describe("assertFalConfigured", () => {
  it("passes when FAL_KEY is set to a non-blank value", () => {
    const original = process.env.FAL_KEY;
    process.env.FAL_KEY = "fk-test-key-123";
    try {
      expect(() => assertFalConfigured()).not.toThrow();
    } finally {
      process.env.FAL_KEY = original;
    }
  });

  it("throws MissingEnvVarsError when FAL_KEY is undefined", () => {
    const original = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    try {
      expect(() => assertFalConfigured()).toThrow(MissingEnvVarsError);
    } finally {
      process.env.FAL_KEY = original;
    }
  });

  it("throws MissingEnvVarsError when FAL_KEY is an empty string", () => {
    const original = process.env.FAL_KEY;
    process.env.FAL_KEY = "";
    try {
      expect(() => assertFalConfigured()).toThrow(MissingEnvVarsError);
    } finally {
      process.env.FAL_KEY = original;
    }
  });

  it("throws MissingEnvVarsError when FAL_KEY is only whitespace", () => {
    const original = process.env.FAL_KEY;
    process.env.FAL_KEY = "   ";
    try {
      expect(() => assertFalConfigured()).toThrow(MissingEnvVarsError);
    } finally {
      process.env.FAL_KEY = original;
    }
  });

  it("error message names FAL_KEY", () => {
    const original = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    try {
      expect(() => assertFalConfigured()).toThrow(/FAL_KEY/);
    } finally {
      process.env.FAL_KEY = original;
    }
  });
});

describe("falSubscribeWithCircuitBreaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the circuit breaker execute method with fal.subscribe", async () => {
    const mockExecute = vi.fn().mockResolvedValue({ data: "test result" });
    vi.mock("@/lib/circuit-breaker", () => ({
      getCircuitBreaker: vi.fn().mockReturnValue({
        execute: mockExecute,
      }),
    }));

    const { falSubscribeWithCircuitBreaker: subscribe } = await import("@/lib/fal");
    const result = await subscribe("fal-ai/flux-fill", {
      input: { prompt: "test" },
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Object)
    );
  });

  it("passes through the result from the circuit breaker", async () => {
    const expectedResult = { data: "image-url" };
    const mockExecute = vi.fn().mockResolvedValue(expectedResult);
    vi.mock("@/lib/circuit-breaker", () => ({
      getCircuitBreaker: vi.fn().mockReturnValue({
        execute: mockExecute,
      }),
    }));

    const { falSubscribeWithCircuitBreaker: subscribe } = await import("@/lib/fal");
    const result = await subscribe("fal-ai/flux-fill", {
      input: { prompt: "test" },
    });

    expect(result).toEqual(expectedResult);
  });

  it("passes modelId and options to fal.subscribe", async () => {
    let capturedArgs: unknown[] = [];
    const mockExecute = vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => {
      capturedArgs = (fn as () => Promise<unknown>).toString().includes("fal") ? ["fal-subscribe-call"] : [];
      return { data: "test" };
    });
    
    vi.mock("@/lib/circuit-breaker", () => ({
      getCircuitBreaker: vi.fn().mockReturnValue({
        execute: mockExecute,
      }),
    }));

    const { falSubscribeWithCircuitBreaker: subscribe } = await import("@/lib/fal");
    await subscribe("fal-ai/flux-fill", {
      input: { prompt: "a beautiful landscape" },
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Object)
    );
  });
});
