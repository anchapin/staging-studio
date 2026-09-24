import { z } from "zod";

const metadataTextField = (label: string) =>
  z.string().max(2000, {
    message: `${label} must be 2,000 characters or fewer`,
  });

/**
 * Zod schema for partial project metadata updates accepted by the
 * `saveProjectMetadata` server action (issue #682).
 *
 * Purpose: validates the client-controlled metadata object before it
 * reaches Prisma so only the six editable project fields
 * (`propertyAddress`, `clientName`, `targetBuyer`, `stagingAesthetic`,
 * `stagingPackage`, `stagingDirectives`) are ever written. All fields
 * are optional (callers save only what changed); `.strict()` rejects
 * unknown keys outright, so a crafted payload carrying `userId` (or any
 * other persisted column) can never transfer ownership or write
 * non-editable fields.
 *
 * Contract: every present field must be a string of at most 2,000
 * characters (matching the client form/textarea caps). Empty strings
 * parse (an edit may clear a value) and an entirely empty object parses
 * (the setup wizard conditionally omits every field) — Prisma ignores
 * absent/undefined keys and `update` tolerates empty `data`.
 *
 * Side effects: none — pure validation.
 */
export const projectMetadataSchema = z
  .object({
    propertyAddress: metadataTextField("Property address"),
    clientName: metadataTextField("Client name"),
    targetBuyer: metadataTextField("Target buyer"),
    stagingAesthetic: metadataTextField("Staging aesthetic"),
    stagingPackage: metadataTextField("Staging package"),
    stagingDirectives: metadataTextField("Staging directives"),
  })
  .partial()
  .strict();

/** The validated shape of a {@link projectMetadataSchema} parse. */
export type ProjectMetadataInput = z.infer<typeof projectMetadataSchema>;

/**
 * Zod schema for partial room metadata updates accepted by the
 * `saveRoomMetadata` server action (issue #682).
 *
 * Purpose: validates the client-controlled room-data object before it
 * reaches Prisma so only the two editable room fields (`name`,
 * `rawDirectives`) are ever written. Both fields are optional (autosave
 * sends only what changed); `.strict()` rejects unknown keys outright,
 * so a crafted payload carrying `projectId` (re-parenting outside the
 * ownership chain), `selectedVariantIndex`, or image URLs can never
 * ride this path.
 *
 * Contract: every present field must be a string of at most 2,000
 * characters (matching the client textarea caps). Empty strings parse
 * (an autosave may clear the directives) and an entirely empty object
 * parses — Prisma ignores absent/undefined keys and `update` tolerates
 * empty `data`.
 *
 * Side effects: none — pure validation.
 */
export const roomMetadataSchema = z
  .object({
    name: metadataTextField("Room name"),
    rawDirectives: metadataTextField("Raw directives"),
  })
  .partial()
  .strict();

/** The validated shape of a {@link roomMetadataSchema} parse. */
export type RoomMetadataInput = z.infer<typeof roomMetadataSchema>;
