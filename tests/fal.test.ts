import { describe, expect, it, vi, beforeEach } from "vitest";

import { assertFalConfigured } from "@/lib/fal";
import { MissingEnvVarsError } from "@/lib/env";

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitBreaker: vi.fn().mockReturnValue({
    execute: mockExecute,
  }),
}));

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
    mockExecute.mockResolvedValue({ data: "default" });
  });

  it("calls the circuit breaker execute method with fal.subscribe", async () => {
    mockExecute.mockResolvedValue({ data: "test result" });

    const { falSubscribeWithCircuitBreaker: subscribe } = await import("@/lib/fal");
    await subscribe("fal-ai/flux-fill", {
      input: { prompt: "test" },
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(expect.any(Function));
  });

  it("unwraps the @fal-ai/client Result envelope to the raw model output (#1192)", async () => {
    const output = {
      masks: [{ url: "https://fal.media/mask-0.png" }, { url: "https://fal.media/mask-1.png" }],
      scores: [0.94, 0.81],
    };
    mockExecute.mockResolvedValue({ data: output, requestId: "req-123" });

    const { falSubscribeWithCircuitBreaker: subscribe } = await import("@/lib/fal");
    const result = await subscribe("fal-ai/sam-3-1/image", {
      input: { prompt: "furniture" },
    });

    expect(result).toEqual(output);
  });

  it("feeds furnishings detection a parseable payload end to end (#1192)", async () => {
    mockExecute.mockResolvedValue({
      data: { masks: [{ url: "https://fal.media/mask-0.png", score: 0.9 }] },
      requestId: "req-456",
    });

    const { falSubscribeWithCircuitBreaker: subscribe } = await import("@/lib/fal");
    const { parseFurnishingDetectionResponse } = await import("@/lib/furnishing-detection");
    const result = await subscribe("fal-ai/sam-3-1/image", { input: { prompt: "furniture" } });

    expect(parseFurnishingDetectionResponse(result)).toEqual({
      maskUrls: ["https://fal.media/mask-0.png"],
      scores: [0.9],
    });
  });

  it("passes a value without the Result envelope through unchanged", async () => {
    const raw = { data: "payload-field", other: 1 };
    mockExecute.mockResolvedValue(raw);

    const { falSubscribeWithCircuitBreaker: subscribe } = await import("@/lib/fal");
    const result = await subscribe("fal-ai/flux-fill", {
      input: { prompt: "test" },
    });

    expect(result).toEqual(raw);
  });

  it("passes modelId and options to fal.subscribe", async () => {
    mockExecute.mockResolvedValue({ data: "test" });

    const { falSubscribeWithCircuitBreaker: subscribe } = await import("@/lib/fal");
    await subscribe("fal-ai/flux-fill", {
      input: { prompt: "a beautiful landscape" },
    });

    expect(mockExecute).toHaveBeenCalledWith(expect.any(Function));
  });
});
