import { z } from "zod";

const metadataTextField = (label: string) =>
  z.string().max(2000, {
    message: `${label} must be 2,000 characters or fewer`,
  });

/**
 * Zod schema for the room-level "saved finish" payload accepted by the
 * `saveRoomFinish` server action (issue #1182).
 *
 * Purpose: validates the client-controlled finish payload before it
 * reaches Prisma so only the three finish-related columns
 * (`materialFinishId`, `materialFinishDirectives`,
 * `materialFinishConceptLabel`) are ever written. `.strict()` rejects
 * unknown keys outright, so a crafted payload carrying `projectId`
 * (re-parenting outside the ownership chain), `userId`, or any other
 * persisted column cannot ride this path.
 *
 * Contract:
 * - Every field is normalized via `emptyToNull` so an empty string
 *   (e.g. a UI "Clear" click) rides the same path as a normal save and
 *   nulls the persisted column.
 * - `materialFinishDirectives` is the staging-directive text the user
 *   chose to lock alongside the finish.
 * - `materialFinishConceptLabel` is the SAM/GPT-4o-mini concept label
 *   captured with the finish (max 200 chars, matches the vision-label
 *   convention).
 *
 * Side effects: none — pure validation.
 */
const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.length > 0 ? v : null;

export const roomFinishSchema = z
  .object({
    materialFinishId: z.preprocess(
      emptyToNull,
      z.string().max(64).nullable()
    ),
    materialFinishDirectives: z.preprocess(
      emptyToNull,
      metadataTextField("Saved finish directives").nullable()
    ),
    materialFinishConceptLabel: z.preprocess(
      emptyToNull,
      z.string().max(200).nullable()
    ),
  })
  .strict();

/** The validated shape of a {@link roomFinishSchema} parse. */
export type RoomFinishInput = z.infer<typeof roomFinishSchema>;