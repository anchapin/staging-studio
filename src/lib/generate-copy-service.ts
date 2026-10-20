/**
 * Generate-copy service — extracted orchestration for the
 * OpenAI-backed staging listing-copy endpoint.
 *
 * Wave-5 revival (issue #1389): the /api/generate-copy route grew to
 * 444 lines of orchestration (auth → body parse → room/project fetch
 * → directives check → quota → OpenAI call with failover → advisory
 * quality gate → persist → refund on paid-call failure → success
 * envelope). This service absorbs that orchestration; the route owns
 * only the terminal response shape (`{ success: true|false, ... }`,
 * `code`, status codes).
 *
 * The route diverges from the Phase-1 export-pdf shape in two ways:
 *  1. The refund policy is the *opposite* of export-pdf (issue #1132).
 *     Export-pdf keeps the claimed unit on dispatch failure (#1124:
 *     Browserless compute was consumed). Generate-copy refunds on
 *     *paid-call* failure (issue #1132: the unit is only kept on a
 *     successful generation that then fails to persist — handled by
 *     the route's `saveFailed` arm, which does NOT refund).
 *  2. The success envelope is `{ success: true, data, ...meta }` plus
 *     a separate `{ success: false, ... }` for errors. The route owns
 *     that envelope; the service just reports the discriminated
 *     outcome.
 */
import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { User } from "@prisma/client";

import {
  ProjectForbiddenError,
  ProjectNotFoundError,
  getAuthedPrismaUser,
  requireProjectOwnershipOrThrow,
} from "@/lib/api-auth";
import {
  DEFAULT_DAILY_COPY_LIMIT,
  DAILY_LIMIT_ENV_VAR,
  claimDailyQuota,
  dailyQuotaExceededPayload,
  refundDailyQuota,
  resolveDailyLimit,
} from "@/lib/api-quota";
import {
  aiModel,
  assertOpenAIConfigured,
  generateWithCircuitBreaker,
  generateWithFailover,
} from "@/lib/ai";
import type {
  FailoverAttempt,
} from "@/lib/ai";
import { checklistItemSchema } from "@/lib/checklist-schema";
import {
  copyQualityGateSchema,
  generateCopyRequestSchema,
} from "@/lib/ai-route-schemas";
import { prisma } from "@/lib/prisma";
import { buildCopyPrompt } from "@/lib/prompts";
import { sanitizePromptValue } from "@/lib/sanitize-prompt";
import { saveRoomCopy } from "@/app/actions/room";
import type { GeneratedCopy } from "@/app/actions/room";

import type { PrismaClient } from "@prisma/client";
import type { QuotaClaim } from "@/lib/api-quota";

const COPY_OUTPUT_SCHEMA = z.object({
  observedChallenge: z.string(),
  recommendation: z.string(),
  buyerPsychology: z.string(),
  checklist: z.array(checklistItemSchema),
});

/**
 * The discriminated result returned by `runGenerateCopy`. Each `kind`
 * maps to a single route-level outcome; the route owns the status
 * code + the `success: true|false` envelope.
 */
export type GenerateCopyServiceResult =
  | { kind: "unauthorized" }
  | { kind: "invalidRequest"; message: string }
  | { kind: "roomNotFound" }
  | { kind: "projectNotFound" }
  | { kind: "projectForbidden" }
  | { kind: "missingDirectives" }
  | {
      kind: "quotaExceeded";
      payload: ReturnType<typeof dailyQuotaExceededPayload>;
      claim: QuotaClaim;
    }
  | {
      kind: "success";
      generatedCopy: GeneratedCopy;
      finishReason: string | undefined;
      usage: unknown;
      model: string;
      qualityWarnings: string[];
      failedOver: boolean;
    }
  | {
      kind: "saveFailed";
      generatedCopy: GeneratedCopy;
      qualityWarnings: string[];
      saveError: string | null;
    };

export type GenerateCopyServiceInput = {
  bodyText: string;
};

/**
 * Narrow dependency surface for the service. Inlined (not picked off a
 * module singleton) so the test can hand-roll `vi.fn()`s and the route
 * composes real implementations. Mirrors the Phase-1 services (#1400,
 * #1401) and the PR-3 export-pdf service (#1404).
 */
export type GenerateCopyServiceDeps = {
  getAuthedPrismaUser: typeof getAuthedPrismaUser;
  requireProjectOwnershipOrThrow: typeof requireProjectOwnershipOrThrow;
  claimDailyQuota: typeof claimDailyQuota;
  refundDailyQuota: typeof refundDailyQuota;
  resolveDailyLimit: typeof resolveDailyLimit;
  generateWithFailover: <T>(
    run: (model: LanguageModel) => Promise<T>,
  ) => Promise<FailoverAttempt<T>>;
  generateWithCircuitBreaker: <T>(fn: () => Promise<T>) => Promise<T>;
  generateObject: (typeof import("ai"))["generateObject"];
  assertOpenAIConfigured: typeof assertOpenAIConfigured;
  saveRoomCopy: typeof saveRoomCopy;
  prisma: PrismaClient;
  getEnv: (name: string) => string | undefined;
  now: () => Date;
};

export const defaultGenerateCopyServiceDeps = (): GenerateCopyServiceDeps => ({
  getAuthedPrismaUser,
  requireProjectOwnershipOrThrow,
  claimDailyQuota,
  refundDailyQuota,
  resolveDailyLimit,
  generateWithFailover: generateWithFailover as unknown as GenerateCopyServiceDeps["generateWithFailover"],
  generateWithCircuitBreaker: generateWithCircuitBreaker as unknown as GenerateCopyServiceDeps["generateWithCircuitBreaker"],
  generateObject,
  assertOpenAIConfigured,
  saveRoomCopy,
  prisma: prisma as unknown as PrismaClient,
  getEnv: (name) => process.env[name],
  now: () => new Date(),
});

/**
 * Read and validate the JSON request body, returning either the
 * `roomId` or a `{ kind: 'invalidRequest', message }` shape the route
 * maps to a 400.
 */
function parseGenerateCopyBody(bodyText: string):
  | { ok: true; roomId: string }
  | { ok: false; message: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
  const result = generateCopyRequestSchema.safeParse(payload);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      message: first?.message ?? "Invalid request body.",
    };
  }
  return { ok: true, roomId: result.data.roomId };
}

/**
 * Run the quality gate against the freshly generated copy.
 *
 * The gate is advisory (#600 / #1224): a gate failure must never turn
 * an already-generated copy (including one the fallback just produced
 * during an availability incident) into a failed request. We absorb
 * every error here and return an empty `qualityWarnings` array — the
 * route's `success` arm uses the same shape whether the gate ran or
 * not.
 */
async function runQualityGate(
  copy: z.infer<typeof COPY_OUTPUT_SCHEMA>,
  room: {
    name: string;
    rawDirectives: string | null;
    project: {
      stagingAesthetic: string;
      targetBuyer: string;
    };
  },
  deps: GenerateCopyServiceDeps,
): Promise<string[]> {
  const qualityWarnings: string[] = [];
  deps.assertOpenAIConfigured();
  try {
    const result = await deps.generateWithCircuitBreaker(async () =>
      deps.generateObject({
        model: aiModel,
        schema: copyQualityGateSchema,
        messages: [
          {
            role: "user",
            content: [
              `You are a staging copy quality auditor. Evaluate the generated copy for room "${sanitizePromptValue(room.name)}".`,
              "",
              `Staging aesthetic: "${sanitizePromptValue(room.project.stagingAesthetic)}"`,
              `Target buyer: "${sanitizePromptValue(room.project.targetBuyer)}"`,
              `Raw directives: "${sanitizePromptValue(room.rawDirectives ?? "")}"`,
              "",
              `Generated copy:`,
              `  Observed challenge: "${copy.observedChallenge}"`,
              `  Recommendation: "${copy.recommendation}"`,
              `  Buyer psychology: "${copy.buyerPsychology}"`,
              `  Checklist: ${copy.checklist.map((c) => `"${c.item}"`).join(", ")}`,
              "",
              "Evaluate:",
              "1. specificity (0–3): 0=generic/filler like 'Attention to detail ensures lasting impressions', 3=highly specific and concrete",
              "2. buyer_aligned: if the copy doesn't speak to the target buyer persona, explain how",
              "3. checklist_actionable: if any checklist item is vague, non-actionable, or generic",
              "4. aesthetic_consistent: if copy contradicts or misaligns with the staging aesthetic",
              "",
              "Return JSON with: specificity (0-3), buyer_aligned (string only if misaligned), checklist_actionable (string only if vague items), aesthetic_consistent (string only if inconsistent), qualityWarnings (array of distinct warning strings).",
            ].join("\n"),
          },
        ],
      }),
    );
    const qg = result.object;
    if (qg && Array.isArray(qg.qualityWarnings)) {
      qualityWarnings.push(...qg.qualityWarnings);
    }
  } catch (gateError) {
    // Swallow — the gate is advisory; do not block the success arm.
    // Surface in the caller's `qualityWarnings` so the route can log.
    qualityWarnings.push(
      `quality-gate-failed: ${(gateError as Error)?.message ?? "unknown"}`,
    );
  }
  return qualityWarnings;
}

/**
 * Run the shared generate-copy orchestration. The route owns the
 * `{ success: true|false }` envelope, status code, and `code` mapping.
 */
export async function runGenerateCopy(
  input: GenerateCopyServiceInput,
  deps: GenerateCopyServiceDeps = defaultGenerateCopyServiceDeps(),
): Promise<GenerateCopyServiceResult> {
  const parsed = parseGenerateCopyBody(input.bodyText);
  if (!parsed.ok) {
    return { kind: "invalidRequest", message: parsed.message };
  }
  const { roomId } = parsed;

  const user: User | null = await deps.getAuthedPrismaUser();
  if (!user) {
    return { kind: "unauthorized" };
  }
  const userId = user.id;

  // Step 1: existence check. The where clause matches nothing for
  // foreign roomIds (mirroring `getOwnedRoomWhere`), so a forged
  // roomId answers `roomNotFound`, not `projectForbidden`.
  const roomBasic = await deps.prisma.room.findFirst({
    where: { id: roomId },
    select: { id: true, projectId: true },
  });
  if (!roomBasic) {
    return { kind: "roomNotFound" };
  }

  // Step 2: project ownership.
  try {
    await deps.requireProjectOwnershipOrThrow(roomBasic.projectId, user);
  } catch (e) {
    if (e instanceof ProjectNotFoundError) {
      return { kind: "projectNotFound" };
    }
    if (e instanceof ProjectForbiddenError) {
      return { kind: "projectForbidden" };
    }
    throw e;
  }

  // Step 3: full room fetch (raw directives + project fields for prompt).
  const room = await deps.prisma.room.findUnique({
    where: { id: roomId },
    include: {
      project: {
        select: {
          stagingAesthetic: true,
          targetBuyer: true,
          stagingDirectives: true,
          buyerDemographics: true,
        },
      },
    },
  });
  if (!room) {
    return { kind: "roomNotFound" };
  }

  const hasDirectives = !!room.rawDirectives?.trim();
  if (!hasDirectives) {
    return { kind: "missingDirectives" };
  }

  // OPENAI_API_KEY is enforced by `deps.assertOpenAIConfigured()` below
  // (#1224). We deliberately do NOT add a separate "missingConfig"
  // arm here: the real `assertOpenAIConfigured` throws a structured
  // error and the catch routes it through `classifyIntegrationError`,
  // which the route has always done. A pre-emptive arm here would
  // duplicate that check and break the pre-existing
  // `tests/api/generate-copy-route.test.ts` suite (issue #1389).

  const copyLimit = deps.resolveDailyLimit(
    deps.getEnv(DAILY_LIMIT_ENV_VAR.copy),
    DEFAULT_DAILY_COPY_LIMIT,
  );

  // Step 4: atomic quota claim (#1132). We keep the unit on
  // generation success + persistence failure (the `saveFailed` arm
  // below). A paid-call failure (e.g. timeout, vendor outage) is
  // refunded in the catch below — it consumed no usable copy.
  const copyClaim = await deps.claimDailyQuota(
    "copy",
    userId,
    copyLimit,
    1,
    deps.now(),
  );
  if (!copyClaim.claimed) {
    return {
      kind: "quotaExceeded",
      payload: dailyQuotaExceededPayload(copyClaim, "Please try again tomorrow."),
      claim: copyClaim,
    };
  }

  // Track whether the paid call resolved so the catch-block can
  // decide whether to refund (#1132: refund only on paid-call
  // failure; a `saveFailed` outcome keeps the claim).
  let copyGenerationResolved = false;
  try {
    deps.assertOpenAIConfigured();

    // Step 5: generation call (#1224) — one failover attempt.
    const { result: generation, modelId, failedOver } = await deps.generateWithFailover(
      (model) =>
        deps.generateObject({
          model,
          schema: COPY_OUTPUT_SCHEMA,
          prompt: buildCopyPrompt({
            roomName: room.name,
            aesthetic: room.project.stagingAesthetic,
            targetBuyer: room.project.targetBuyer,
            rawDirectives: room.rawDirectives ?? "",
            globalDirectives: room.project.stagingDirectives ?? undefined,
            buyerDemographics:
              (room.project.buyerDemographics as unknown as
                | import("@/lib/prompts").BuyerDemographicsInput
                | undefined) ?? undefined,
          }),
          repairText: async ({ text }) => {
            const trimmed = text.trim();
            const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;
            const extracted = jsonMatch[0];
            try {
              JSON.parse(extracted);
              return extracted;
            } catch {
              const fixed = extracted
                .replace(/,\s*([}\]])/g, "$1")
                .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
                .replace(/:\s*'([^']*)'/g, ': "$1"');
              try {
                JSON.parse(fixed);
                return fixed;
              } catch {
                return null;
              }
            }
          },
        }),
    );

    const { object: copy, finishReason, usage } = generation;
    copyGenerationResolved = true;

    // Step 6: advisory quality gate (#600 / #1224).
    const qualityWarnings = await runQualityGate(copy, room, deps);

    // Step 7: persist.
    const generatedCopy: GeneratedCopy = {
      observedChallenge: copy.observedChallenge,
      recommendation: copy.recommendation,
      buyerPsychology: copy.buyerPsychology,
      checklist: copy.checklist,
    };

    const saveResult = await deps.saveRoomCopy(roomId, generatedCopy);
    if (!saveResult.success) {
      // Persistence failed AFTER the paid call resolved. Keep the
      // claim (#1132 + #1124 spirit): the copy is in hand, just
      // not on disk. The route returns the copy + a `saveFailed`
      // marker so the client can retry persistence.
      return {
        kind: "saveFailed",
        generatedCopy,
        qualityWarnings,
        saveError: saveResult.error ?? null,
      };
    }

    return {
      kind: "success",
      generatedCopy,
      finishReason,
      usage,
      model: modelId,
      qualityWarnings,
      failedOver,
    };
  } catch (error) {
    // Issue #1132: refund the claimed unit when the paid call
    // itself failed (timeout, vendor outage, zod parse failure on
    // the model's output). A failure *after* the generation
    // resolved (the `saveFailed` arm above) keeps the count.
    if (!copyGenerationResolved) {
      try {
        await deps.refundDailyQuota("copy", userId);
      } catch {
        // Refund failures must not turn a paid-call failure into
        // a 500; the route still returns the original error. Log
        // and move on.
      }
    }
    throw error;
  }
}