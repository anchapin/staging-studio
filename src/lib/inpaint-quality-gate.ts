import { generateObject } from "ai";
import type { z } from "zod";
import { inpaintQualityGateSchema } from "@/lib/ai-route-schemas";
import { aiModel, assertOpenAIConfigured } from "@/lib/ai";

/**
 * Inpaint pre-flight quality gate (issue #600), made failure-tolerant of
 * OpenAI outages (issue #685).
 *
 * Contract: `evaluateInpaintQualityGate` is ADVISORY ONLY — it must never
 * fail an inpaint submission. Any evaluator failure (throwing client,
 * rate limit, timeout, missing `OPENAI_API_KEY`) skips the gate and
 * yields empty warnings so the fal.ai pipeline stays available when the
 * second, advisory vendor is down. `maskCoverageRatio` omitted/undefined
 * also skips the gate (no OpenAI spend).
 *
 * Side effects: one `generateObject` call against gpt-4o-mini when the
 * gate runs; one `console.debug` line when it is skipped.
 */

export type InpaintQualityGateResult = z.infer<typeof inpaintQualityGateSchema>;

/** Inputs the gate needs; `maskCoverageRatio` undefined ⇒ gate is skipped. */
export interface InpaintQualityGateParams {
  roomName: string;
  maskCoverageRatio: number | undefined;
  promptDirectives: string;
}

/**
 * Builds the gate evaluation prompt.
 *
 * Purpose: pure prompt construction, kept byte-equivalent to the inline
 * prompt this module was extracted from (route.ts, issue #600), so the
 * model's inputs do not drift.
 *
 * Side effects: none — pure function.
 */
export function buildInpaintQualityGatePrompt(params: {
  roomName: string;
  maskCoverageRatio: number;
  promptDirectives: string;
}): string {
  return [
    `You are a staging quality auditor. Evaluate the inpaint directive for a room named "${params.roomName}".`,
    "",
    `Mask coverage ratio: ${(params.maskCoverageRatio * 100).toFixed(1)}% of the canvas is masked for regeneration.`,
    "",
    `Directives: "${params.promptDirectives}"`,
    "",
    "Evaluate:",
    "1. specificity (0–3): 0=completely generic/vague, 3=highly specific and concrete",
    "2. architecture_risk: if the directives mention changing walls, flooring, windows, trim, doors, or ceiling AND the mask does not cover those areas, explain the risk",
    "3. mentions_furnishings: if the directives describe what the mask actually covers (the furnishings/objects being staged), note that the alignment is positive",
    "",
    "Return a JSON object with: specificity (number 0-3), architecture_risk (string only if risk exists), mentions_furnishings (string only if positive), qualityWarnings (array of distinct warning strings).",
  ].join("\n");
}

/**
 * Flattens one gate result into the advisory warning list.
 *
 * Purpose: pure decision core — `architecture_risk` rides first, then the
 * model's own `qualityWarnings` — so the mapping is testable without
 * OpenAI.
 *
 * Side effects: none — pure function.
 */
export function qualityWarningsFromGateResult(
  result: InpaintQualityGateResult
): string[] {
  const warnings: string[] = [];
  if (result.architecture_risk) {
    warnings.push(result.architecture_risk);
  }
  if (result.qualityWarnings) {
    warnings.push(...result.qualityWarnings);
  }
  return warnings;
}

/**
 * Runs the advisory quality gate, skipping gracefully on ANY failure
 * (issue #685).
 *
 * Purpose: the single call site for `POST /api/inpaint`'s pre-flight
 * gate. Returns the advisory warnings on success, `[]` when the gate is
 * skipped (`maskCoverageRatio` undefined) or when the evaluator fails —
 * never throws, so an OpenAI outage cannot take down an otherwise
 * healthy fal.ai submission.
 *
 * Side effects: one `generateObject` call (gpt-4o-mini) when the gate
 * runs; `console.debug` on skip-by-failure.
 */
export async function evaluateInpaintQualityGate(
  params: InpaintQualityGateParams
): Promise<string[]> {
  if (params.maskCoverageRatio === undefined) {
    return [];
  }

  try {
    assertOpenAIConfigured();
    const { object: qg } = await generateObject({
      model: aiModel,
      schema: inpaintQualityGateSchema,
      messages: [
        {
          role: "user",
          content: buildInpaintQualityGatePrompt({
            roomName: params.roomName,
            maskCoverageRatio: params.maskCoverageRatio,
            promptDirectives: params.promptDirectives,
          }),
        },
      ],
    });
    return qualityWarningsFromGateResult(qg);
  } catch (error) {
    console.debug(
      JSON.stringify({
        event: "inpaint_quality_gate_skipped",
        reason: error instanceof Error ? error.message : String(error),
      })
    );
    return [];
  }
}
