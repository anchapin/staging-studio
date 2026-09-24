/**
 * Room type detection via GPT-4o-mini vision (issue #788).
 *
 * The ROOM_TYPE_SYSTEM_PROMPT is defined in prompts.ts (issue #788) and
 * re-exported here for backward compatibility. The function itself is
 * tested in isolation, matching the pattern used for other vision prompt modules.
 */

import { z } from "zod";
import { aiModel, assertOpenAIConfigured } from "@/lib/ai";
import { ROOM_TYPE_SYSTEM_PROMPT } from "@/lib/prompts";

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
