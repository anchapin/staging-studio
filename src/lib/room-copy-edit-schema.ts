import { z } from "zod";

import { checklistItemSchema } from "@/lib/checklist-schema";

/**
 * Zod schema for partial room-copy edits persisted by the `saveRoomCopyEdits`
 * server action (issue #250).
 *
 * Contract: only the four AI-copy fields are editable here — the three prose
 * fields (1–2000 chars each) and the `checklistItems` array (existing
 * `checklistItemSchema` items; delete = omitted entry, no add/reorder keys).
 * `.strict()` rejects unknown keys outright so persisted fields like
 * `selectedVariantIndex` or image URLs can never ride this path; an
 * entirely empty body is rejected because an autosave must carry at least
 * one field.
 *
 * Side effects: none — pure validation.
 */
export const roomCopyEditSchema = z
  .object({
    observedChallenge: z.string().min(1).max(2000),
    recommendation: z.string().min(1).max(2000),
    buyerPsychology: z.string().min(1).max(2000),
    checklistItems: z.array(checklistItemSchema),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export type RoomCopyEditInput = z.infer<typeof roomCopyEditSchema>;
