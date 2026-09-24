import { z } from "zod";

export const checklistItemSchema = z.object({
  item: z.string(),
  completed: z.boolean(),
  notes: z.string(),
});

export const generatedCopySchema = z.object({
  observedChallenge: z.string(),
  recommendation: z.string(),
  buyerPsychology: z.string(),
  checklist: z.array(checklistItemSchema),
});

export type GeneratedCopy = z.infer<typeof generatedCopySchema>;

interface SaveResult {
  success: boolean;
  error?: string;
}

/**
 * Persists generated staging copy for a room.
 * Returns { success: true } on success, { success: false, error: "..." } on failure.
 */
export async function saveRoomCopy(
  roomId: string,
  copy: GeneratedCopy
): Promise<SaveResult> {
  // TODO: Implement actual persistence
  // This is a stub that always succeeds
  console.log(`[stub] saveRoomCopy for room ${roomId}:`, JSON.stringify(copy, null, 2));
  return { success: true };
}
