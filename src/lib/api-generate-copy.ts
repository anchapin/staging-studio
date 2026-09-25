import { NextRequest } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import { prisma } from "@/lib/prisma";
import { aiModel, generateWithCircuitBreaker } from "@/lib/ai";
import { generateCopyRequestSchema, copyQualityGateSchema } from "@/lib/ai-route-schemas";
import { buildCopyPrompt, BuyerDemographicsInput } from "@/lib/prompts";
import { checklistItemSchema } from "@/lib/checklist-schema";
import { saveRoomCopy, type GeneratedCopy } from "@/app/actions/room";

const CopyOutputSchema = z.object({
  observedChallenge: z.string(),
  recommendation: z.string(),
  buyerPsychology: z.string(),
  checklist: z.array(checklistItemSchema),
});

export interface GenerateCopyResult {
  success: true;
  data: GeneratedCopy;
  qualityWarnings: string[];
}

export interface GenerateCopyParams {
  userId: string;
  roomId: string;
  request: NextRequest;
}

export async function generateCopyForRoom(
  params: GenerateCopyParams
): Promise<GenerateCopyResult> {
  const { userId, roomId, request } = params;

  const body = await request.json();
  const parsed = generateCopyRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new GenerateCopyValidationError(parsed.error);
  }

  const room = await prisma.room.findFirst({
    where: { id: roomId, project: { userId: userId } },
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
    throw new GenerateCopyNotFoundError();
  }

  const hasDirectives =
    room.rawDirectives?.trim() || room.project.stagingDirectives?.trim();
  if (!hasDirectives) {
    throw new GenerateCopyMissingDirectivesError();
  }

  const { object: copy } = await generateWithCircuitBreaker(async () =>
    generateObject({
      model: aiModel,
      schema: CopyOutputSchema,
      prompt: buildCopyPrompt({
        roomName: room.name,
        aesthetic: room.project.stagingAesthetic,
        targetBuyer: room.project.targetBuyer,
        rawDirectives: room.rawDirectives ?? "",
        globalDirectives: room.project.stagingDirectives ?? undefined,
        buyerDemographics: (room.project.buyerDemographics as unknown as BuyerDemographicsInput | undefined) ?? undefined,
      }),
    })
  );

  const qualityWarnings: string[] = [];
  const { object: qg } = await generateWithCircuitBreaker(async () =>
    generateObject({
      model: aiModel,
      schema: copyQualityGateSchema,
      messages: [
        {
          role: "user",
          content: [
            `You are a staging copy quality auditor. Evaluate the generated copy for room "${room.name}".`,
            "",
            `Staging aesthetic: "${room.project.stagingAesthetic}"`,
            `Target buyer: "${room.project.targetBuyer}"`,
            `Raw directives: "${room.rawDirectives ?? ""}"`,
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
    })
  );
  if (qg.buyer_aligned) {
    qualityWarnings.push(qg.buyer_aligned);
  }
  if (qg.checklist_actionable) {
    qualityWarnings.push(qg.checklist_actionable);
  }
  if (qg.aesthetic_consistent) {
    qualityWarnings.push(qg.aesthetic_consistent);
  }
  if (qg.qualityWarnings) {
    qualityWarnings.push(...qg.qualityWarnings);
  }

  const generatedCopy: GeneratedCopy = {
    observedChallenge: copy.observedChallenge,
    recommendation: copy.recommendation,
    buyerPsychology: copy.buyerPsychology,
    checklist: copy.checklist,
  };

  const saveResult = await saveRoomCopy(roomId, generatedCopy);
  if (!saveResult.success) {
    throw new GenerateCopySaveError(saveResult.error ?? "Save failed");
  }

  return { success: true, data: generatedCopy, qualityWarnings };
}

export class GenerateCopyValidationError extends Error {
  declare cause: z.ZodError;
  constructor(error: z.ZodError) {
    super("Validation failed");
    this.name = "GenerateCopyValidationError";
    this.cause = error;
  }
}

export class GenerateCopyNotFoundError extends Error {
  constructor() {
    super("Room not found");
    this.name = "GenerateCopyNotFoundError";
  }
}

export class GenerateCopyMissingDirectivesError extends Error {
  constructor() {
    super("Missing staging directives");
    this.name = "GenerateCopyMissingDirectivesError";
  }
}

export class GenerateCopySaveError extends Error {
  retryable: boolean;
  constructor(message: string) {
    super(message);
    this.name = "GenerateCopySaveError";
    this.retryable = true;
  }
}
