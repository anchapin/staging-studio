/**
 * Unit tests for inpaint-quality-gate.ts (issues #600 / #685).
 *
 * Note: These tests mock the `ai` SDK (`generateObject`) and `@/lib/ai`
 * (`aiModel`, `assertOpenAIConfigured`) so no OpenAI request is ever made.
 * They pin the issue #685 contract: the gate is advisory only — ANY
 * evaluator failure (throwing client, rate limit, missing key) skips the
 * gate with empty warnings and never propagates an error to the caller.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  buildInpaintQualityGatePrompt,
  evaluateInpaintQualityGate,
  qualityWarningsFromGateResult,
} from "@/lib/inpaint-quality-gate";
import { generateObject } from "ai";
import { assertOpenAIConfigured } from "@/lib/ai";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({
  aiModel: { modelId: "gpt-4o-mini-mock" },
  assertOpenAIConfigured: vi.fn(),
}));

const generateObjectMock = generateObject as unknown as Mock;
const assertOpenAIConfiguredMock = assertOpenAIConfigured as unknown as Mock;

const PARAMS = {
  roomName: "Living Room",
  maskCoverageRatio: 0.42,
  promptDirectives: "Add a mid-century sofa and warm lighting",
} as const;

function mockGateResult(result: Record<string, unknown>): void {
  generateObjectMock.mockResolvedValue({ object: result });
}

beforeEach(() => {
  vi.clearAllMocks();
  assertOpenAIConfiguredMock.mockImplementation(() => {});
});

describe("evaluateInpaintQualityGate — skip on failure (#685)", () => {
  it("returns empty warnings when generateObject throws a rate-limit error", async () => {
    generateObjectMock.mockRejectedValue(
      new Error("429 Rate limit exceeded for gpt-4o-mini")
    );

    const warnings = await evaluateInpaintQualityGate(PARAMS);

    expect(warnings).toEqual([]);
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty warnings when generateObject rejects with a non-Error", async () => {
    generateObjectMock.mockRejectedValue("upstream outage");

    await expect(evaluateInpaintQualityGate(PARAMS)).resolves.toEqual([]);
  });

  it("returns empty warnings when assertOpenAIConfigured throws (missing key)", async () => {
    assertOpenAIConfiguredMock.mockImplementation(() => {
      throw new Error("Missing environment variable: OPENAI_API_KEY");
    });

    const warnings = await evaluateInpaintQualityGate(PARAMS);

    expect(warnings).toEqual([]);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("never throws, even for unexpected rejection shapes", async () => {
    generateObjectMock.mockRejectedValue(undefined);

    await expect(evaluateInpaintQualityGate(PARAMS)).resolves.toEqual([]);
  });

  it("skips the OpenAI call entirely when maskCoverageRatio is undefined", async () => {
    const warnings = await evaluateInpaintQualityGate({
      ...PARAMS,
      maskCoverageRatio: undefined,
    });

    expect(warnings).toEqual([]);
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(assertOpenAIConfiguredMock).not.toHaveBeenCalled();
  });
});

describe("evaluateInpaintQualityGate — success path", () => {
  it("flattens architecture_risk and qualityWarnings from the gate result", async () => {
    mockGateResult({
      specificity: 1,
      architecture_risk: "Directives mention flooring but mask covers furnishings only.",
      mentions_furnishings: "Directives align with the masked furnishings.",
      qualityWarnings: ["Directives are too generic."],
    });

    const warnings = await evaluateInpaintQualityGate(PARAMS);

    expect(warnings).toEqual([
      "Directives mention flooring but mask covers furnishings only.",
      "Directives are too generic.",
    ]);
  });

  it("returns empty warnings when the gate result has none", async () => {
    mockGateResult({
      specificity: 3,
      qualityWarnings: [],
    });

    await expect(evaluateInpaintQualityGate(PARAMS)).resolves.toEqual([]);
  });
});

describe("qualityWarningsFromGateResult", () => {
  it("drops empty/absent architecture_risk", () => {
    expect(
      qualityWarningsFromGateResult({
        specificity: 2,
        architecture_risk: "",
        qualityWarnings: [],
      })
    ).toEqual([]);
    expect(
      qualityWarningsFromGateResult({ specificity: 2, qualityWarnings: [] })
    ).toEqual([]);
  });

  it("appends architecture_risk before the model's warnings", () => {
    expect(
      qualityWarningsFromGateResult({
        specificity: 0,
        architecture_risk: "Mask misses the ceiling being repainted.",
        qualityWarnings: ["Too vague.", "No concrete items."],
      })
    ).toEqual([
      "Mask misses the ceiling being repainted.",
      "Too vague.",
      "No concrete items.",
    ]);
  });
});

describe("buildInpaintQualityGatePrompt", () => {
  it("includes room name, coverage percentage, and directives", () => {
    const prompt = buildInpaintQualityGatePrompt({
      roomName: "Primary Bedroom",
      maskCoverageRatio: 0.256,
      promptDirectives: "Stage a queen bed with neutral linens",
    });

    expect(prompt).toContain('room named "Primary Bedroom"');
    expect(prompt).toContain("Mask coverage ratio: 25.6%");
    expect(prompt).toContain(
      'Directives: "Stage a queen bed with neutral linens"'
    );
    expect(prompt).toContain("Return a JSON object with:");
  });
});
