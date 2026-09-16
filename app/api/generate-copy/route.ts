import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiModel } from "@/lib/ai";
import { saveRoomCopy, type GeneratedCopy } from "@/app/actions/room";

const ChecklistItemSchema = z.object({
  item: z.string(),
  category: z.enum(["DIY/Declutter", "Rental Inventory", "Minor Repair"]),
  priority: z.enum(["Critical", "High", "Standard"]),
});

const CopyOutputSchema = z.object({
  observedChallenge: z.string(),
  recommendation: z.string(),
  buyerPsychology: z.string(),
  checklist: z.array(ChecklistItemSchema),
});

const RequestSchema = z.object({
  roomId: z.string(),
  roomName: z.string(),
  rawDirectives: z.string(),
  aesthetic: z.string(),
  targetBuyer: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomId, roomName, rawDirectives, aesthetic, targetBuyer } =
      RequestSchema.parse(body);

    const { object: copy, finishReason, usage } = await generateObject({
      model: aiModel,
      schema: CopyOutputSchema,
      prompt: `You are a professional home staging copywriter for a staging company.

Generate structured copywriting for a room with the following details:
- Room: ${roomName}
- Design Aesthetic: ${aesthetic}
- Target Buyer: ${targetBuyer}
- Staging Directives: ${rawDirectives}

Based on the room details and staging directives, generate:
1. **observedChallenge**: Describe the key staging challenge or opportunity observed in this room
2. **recommendation**: A compelling, actionable staging recommendation that aligns with the aesthetic and buyer profile
3. **buyerPsychology**: Insight into what this buyer profile is looking for and how staging addresses their emotional drivers
4. **checklist**: A prioritized action checklist with categories:
   - DIY/Declutter: Simple fixes sellers can do themselves
   - Rental Inventory: Items that can be rented/procured
   - Minor Repair: Small repairs and touch-ups needed

Be specific, professional, and focused on maximizing the room's appeal to ${targetBuyer}.`,
    });

    const generatedCopy: GeneratedCopy = {
      observedChallenge: copy.observedChallenge,
      recommendation: copy.recommendation,
      buyerPsychology: copy.buyerPsychology,
      checklist: copy.checklist,
    };

    const saveResult = await saveRoomCopy(roomId, generatedCopy);
    if (!saveResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Copy generated but failed to save: ${saveResult.error}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: generatedCopy,
        finishReason,
        usage,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Generate copy error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to generate copy",
      },
      { status: 500 }
    );
  }
}
