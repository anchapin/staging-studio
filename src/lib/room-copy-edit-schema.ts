import { z } from "zod";

import { checklistItemSchema } from "@/lib/checklist-schema";

/**
 * Zod schema for the listing-copy payload persisted by the
 * `saveListingCopy` server action (issue #1343).
 *
 * Contract: both `lookbookHeadline` and `lookbookBody` are required
 * strings (the autosave always carries both — the panel never
 * sends a partial). Both allow empty strings because an explicit
 * clear is distinct from "never touched" in the lookbook render
 * (a cleared column falls back to the legacy `recommendation` body
 * for body, or hides the headline strip entirely). The 600-char
 * cap on the body matches the CopyPanel's `maxLength={600}` HTML
 * attribute; the server enforces the same cap so a non-browser
 * caller (a curl request, a future native client) cannot bypass it.
 * `.strict()` rejects unknown keys outright so client-controlled
 * extras can never ride this write path.
 *
 * Side effects: none — pure validation.
 */
export const listingCopySchema = z
  .object({
    lookbookHeadline: z.string().max(200),
    lookbookBody: z.string().max(600),
  })
  .strict();

export type ListingCopyInput = z.infer<typeof listingCopySchema>;

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
    observedChallenge: z.string().min(0).max(2000),
    recommendation: z.string().min(0).max(2000),
    buyerPsychology: z.string().min(0).max(2000),
    checklistItems: z.array(checklistItemSchema),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export type RoomCopyEditInput = z.infer<typeof roomCopyEditSchema>;

/**
 * Zod schema for the full-form AI-copy payload persisted by the
 * `saveRoomCopy` server action (issue #703).
 *
 * Contract: mirrors the `GeneratedCopy` shape exactly — the three prose
 * fields (1–2000 chars each, the same caps as `roomCopyEditSchema`) and
 * the `checklist` array (existing `checklistItemSchema` items). All four
 * fields are required (unlike the partial edit schema), and `.strict()`
 * rejects unknown keys outright so client-controlled extras can never
 * ride this write path.
 *
 * Side effects: none — pure validation.
 */
export const generatedCopySchema = z
  .object({
    observedChallenge: z.string().min(1).max(2000),
    recommendation: z.string().min(1).max(2000),
    buyerPsychology: z.string().min(1).max(2000),
    checklist: z.array(checklistItemSchema),
  })
  .strict();

export type GeneratedCopyInput = z.infer<typeof generatedCopySchema>;
