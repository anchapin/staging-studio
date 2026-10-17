import { z } from "zod";

/**
 * Upper bound on rooms accepted by a single `POST /api/projects` call.
 * Mirrors `BATCH_ROOM_MAX_FILES` on the batch-upload path so neither
 * entry point can insert an unbounded number of `Room` rows in one
 * statement (issue #1134).
 */
export const PROJECT_CREATE_MAX_ROOMS = 20;

const projectTextField = (label: string) =>
  z
    .string()
    .min(1, { message: `${label} is required` })
    .max(2000, { message: `${label} must be 2,000 characters or fewer` });

/**
 * Zod schema for the six buyer-demographics fields the lookbook's buyer
 * persona page reads.
 *
 * Purpose: `buyerDemographics` lands in a Prisma `Json?` column, so the
 * database enforces nothing. `BuyerPersonaPage` destructures the object
 * and calls `.map` on two of its fields, and that component renders on
 * the cookie-less print page Browserless fetches — a non-conforming
 * value therefore throws server-side and fails the PDF export for the
 * whole lookbook, not just its own page (issue #1134).
 *
 * The label maps in the persona page already fall back to the raw value
 * for an unrecognised enum member (`BUYER_TYPE_LABELS[buyerType] ??
 * buyerType`), so the string fields stay permissive: what matters is
 * that the object has the right SHAPE — the two array fields are arrays
 * of strings and the two budget fields are numbers.
 *
 * Side effects: none (pure validation).
 */
export const buyerDemographicsSchema = z
  .object({
    buyerType: z.string().min(1).max(100),
    designPreferences: z.array(z.string().max(100)).max(50),
    budgetMin: z.number().finite().nonnegative(),
    budgetMax: z.number().finite().nonnegative(),
    mustHaveFeatures: z.array(z.string().max(100)).max(50),
    sellTimeline: z.string().min(1).max(100),
  })
  .strict();

/** The validated shape of a {@link buyerDemographicsSchema} parse. */
export type BuyerDemographicsValue = z.infer<typeof buyerDemographicsSchema>;

/**
 * Zod schema for the `POST /api/projects` request body (issue #1134).
 *
 * Purpose: this route previously destructured `request.json()` and
 * checked four fields for truthiness, so `rooms` could be any length
 * (or a non-array, throwing a 500 after the auth work) and
 * `buyerDemographics` accepted any JSON of any size straight into the
 * `Json?` column. `.strict()` rejects unknown keys, so a crafted
 * payload carrying `userId` or any other persisted column can never
 * ride this path — matching the hardening already applied to every
 * sibling write (`roomPatchSchema`, `createRoomsBatchRequestSchema`).
 *
 * Side effects: none (pure validation).
 */
export const projectCreateRequestSchema = z
  .object({
    propertyAddress: projectTextField("Property address"),
    clientName: projectTextField("Client name"),
    targetBuyer: projectTextField("Target buyer"),
    stagingAesthetic: projectTextField("Staging aesthetic"),
    stagingPackage: z.string().max(2000).nullish(),
    buyerDemographics: buyerDemographicsSchema.nullish(),
    rooms: z
      .array(z.string().min(1).max(100))
      .max(PROJECT_CREATE_MAX_ROOMS, {
        message: `A project can be created with at most ${PROJECT_CREATE_MAX_ROOMS} rooms`,
      })
      .optional()
      .default([]),
  })
  .strict();

/** The validated shape of a {@link projectCreateRequestSchema} parse. */
export type ProjectCreateInput = z.infer<typeof projectCreateRequestSchema>;

/**
 * Narrows a persisted `buyerDemographics` JSON value to the shape the
 * lookbook can render, returning null for anything else.
 *
 * Purpose: read-side counterpart to the write-side schema above. Rows
 * written before validation existed (or through any other path) are
 * degraded to "no buyer persona page" rather than throwing inside the
 * print render and taking the whole export down with them.
 *
 * Side effects: none (pure validation).
 */
export function parseBuyerDemographics(value: unknown): BuyerDemographicsValue | null {
  const parsed = buyerDemographicsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
