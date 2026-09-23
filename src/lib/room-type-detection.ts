/**
 * Room type detection via GPT-4o-mini vision (issue #788).
 *
 * Extracted from room-batch.ts so the prompt can be reviewed and tested
 * in isolation, matching the pattern used for other vision prompt modules.
 */

import { z } from "zod";
import { aiModel, assertOpenAIConfigured } from "@/lib/ai";

/** System prompt sent to GPT-4o-mini for room type classification. */
export const ROOM_TYPE_SYSTEM_PROMPT = `You are an expert interior design assistant. Given a room photo, identify the room type from this list:
- Primary Bedroom
- Secondary Bedroom
- Living Room
- Dining Room
- Kitchen
- Bathroom
- Home Office
- Garage
- Outdoor/Patio
- Other

Respond with ONLY the room type name. If uncertain, respond with the most likely option.`;

/**
 * Detects the room type of an image using GPT-4o-mini vision.
 * Returns a room type label string.
 */
export async function detectRoomType(imageDataUrl: string): Promise<string> {
  const { generateObject } = await import("ai");

  assertOpenAIConfigured();

  const { object } = await generateObject({
    model: aiModel,
    schema: z.object({ roomType: z.string() }),
    messages: [
      { role: "system", content: ROOM_TYPE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text" as const, text: "What type of room is shown in this photo?" },
          { type: "image" as const, image: imageDataUrl },
        ],
      },
    ],
  });

  return object.roomType ?? "Other";
}
