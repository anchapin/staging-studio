import { describe, expect, it } from "vitest";
import { NoObjectGeneratedError } from "ai";
import {
  describeNoObjectGeneratedError,
  type NoObjectGeneratedErrorFields,
} from "@/lib/no-object-error";

function makeNoObjectError(overrides: {
  message?: string;
  cause?: unknown;
  text?: string;
  finishReason?: string;
  usage?: Record<string, number | undefined>;
} = {}): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: overrides.message ?? "No object generated: response did not match schema.",
    cause: overrides.cause as Error | undefined,
    text: overrides.text,
    response: {
      id: "resp_123",
      timestamp: new Date("2026-01-01T00:00:00Z"),
      modelId: "gpt-4o-mini",
    },
    usage: (overrides.usage ?? {}) as never,
    finishReason: ("finishReason" in overrides
      ? overrides.finishReason
      : "stop") as never,
  });
}

describe("describeNoObjectGeneratedError", () => {
  it("returns null for non-NoObjectGeneratedError values", () => {
    expect(describeNoObjectGeneratedError(new Error("boom"))).toBeNull();
    expect(describeNoObjectGeneratedError("boom")).toBeNull();
    expect(describeNoObjectGeneratedError(null)).toBeNull();
    expect(
      describeNoObjectGeneratedError({ name: "NoObjectGeneratedError" })
    ).toBeNull();
  });

  it("extracts name, cause, text, finishReason, and usage when present", () => {
    const error = makeNoObjectError({
      cause: new TypeError("Unexpected token o in JSON"),
      text: '{"observedChallenge": "par',
      finishReason: "length",
      usage: { inputTokens: 120, outputTokens: 5, totalTokens: 125 },
    });

    expect(describeNoObjectGeneratedError(error)).toEqual({
      name: "AI_NoObjectGeneratedError",
      message: "No object generated: response did not match schema.",
      cause: "TypeError: Unexpected token o in JSON",
      text: '{"observedChallenge": "par',
      finishReason: "length",
      usage: { inputTokens: 120, outputTokens: 5, totalTokens: 125 },
    } satisfies NoObjectGeneratedErrorFields);
  });

  it("omits optional fields that are undefined", () => {
    const error = makeNoObjectError({
      usage: { inputTokens: undefined, outputTokens: undefined },
      finishReason: undefined,
    });

    expect(describeNoObjectGeneratedError(error)).toEqual({
      name: "AI_NoObjectGeneratedError",
      message: "No object generated: response did not match schema.",
    });
  });

  it("serializes string causes verbatim and object causes as JSON", () => {
    const withStringCause = makeNoObjectError({ cause: "provider 500" });
    expect(describeNoObjectGeneratedError(withStringCause)?.cause).toBe(
      "provider 500"
    );

    const withObjectCause = makeNoObjectError({
      cause: { code: "invalid_json" },
    });
    expect(describeNoObjectGeneratedError(withObjectCause)?.cause).toBe(
      '{"code":"invalid_json"}'
    );
  });

  it("keeps only numeric usage fields", () => {
    const error = makeNoObjectError({
      usage: {
        inputTokens: 10,
        outputTokens: undefined,
        totalTokens: 10,
        reasoningTokens: undefined,
      },
    });

    expect(describeNoObjectGeneratedError(error)?.usage).toEqual({
      inputTokens: 10,
      totalTokens: 10,
    });
  });
});
