import { describe, expect, it, vi, beforeEach } from "vitest";

import { assertOpenAIConfigured, aiModel } from "@/lib/ai";
import { MissingEnvVarsError } from "@/lib/env";

describe("assertOpenAIConfigured", () => {
  it("passes when OPENAI_API_KEY is set to a non-blank value", () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-key-456";
    try {
      expect(() => assertOpenAIConfigured()).not.toThrow();
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
  });

  it("throws MissingEnvVarsError when OPENAI_API_KEY is undefined", () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => assertOpenAIConfigured()).toThrow(MissingEnvVarsError);
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
  });

  it("throws MissingEnvVarsError when OPENAI_API_KEY is an empty string", () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "";
    try {
      expect(() => assertOpenAIConfigured()).toThrow(MissingEnvVarsError);
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
  });

  it("throws MissingEnvVarsError when OPENAI_API_KEY is only whitespace", () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "   ";
    try {
      expect(() => assertOpenAIConfigured()).toThrow(MissingEnvVarsError);
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
  });

  it("error message names OPENAI_API_KEY", () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => assertOpenAIConfigured()).toThrow(/OPENAI_API_KEY/);
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
  });
});

describe("aiModel", () => {
  it("is a non-null model instance", () => {
    expect(aiModel).toBeDefined();
    expect(aiModel).not.toBeNull();
  });

  it("is the gpt-4o-mini model", () => {
    expect(aiModel.modelId).toBe("gpt-4o-mini");
  });
});

describe("generateWithCircuitBreaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the circuit breaker execute method with the provided function", async () => {
    const mockExecute = vi.fn().mockResolvedValue({ text: "test response" });
    vi.mock("@/lib/circuit-breaker", () => ({
      getCircuitBreaker: vi.fn().mockReturnValue({
        execute: mockExecute,
      }),
    }));

    const { generateWithCircuitBreaker: generate } = await import("@/lib/ai");
    const mockFn = vi.fn().mockResolvedValue({ text: "test response" });
    const result = await generate(mockFn);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(mockFn, expect.any(Object));
    expect(result).toEqual({ text: "test response" });
  });

  it("passes through the result from the circuit breaker", async () => {
    const expectedResult = { text: "hello world" };
    const mockExecute = vi.fn().mockResolvedValue(expectedResult);
    vi.mock("@/lib/circuit-breaker", () => ({
      getCircuitBreaker: vi.fn().mockReturnValue({
        execute: mockExecute,
      }),
    }));

    const { generateWithCircuitBreaker: generate } = await import("@/lib/ai");
    const result = await generate(async () => expectedResult);

    expect(result).toEqual(expectedResult);
  });
});
