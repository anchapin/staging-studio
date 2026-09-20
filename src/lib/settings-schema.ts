import { z } from "zod";

const IMAGE_HOST_PATTERN = /(^|\.)supabase\.co$|(^|\.)fal\.ai$/;

/**
 * Required short text (firm/owner name): trimmed, non-empty, sanity cap.
 */
const requiredTextSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, { message: `${label} is required` })
    .max(200, { message: `${label} must be 200 characters or fewer` });

/**
 * Optional long-form template text: trimmed; an empty/whitespace-only
 * value is normalized to `null` so Prisma clears the column instead of
 * storing blank strings (mirrors the setup route's `|| null` handling).
 */
const optionalTextSchema = z
  .string()
  .max(10000, { message: "Must be 10,000 characters or fewer" })
  .transform((value) => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

/**
 * Optional logo URL: an empty/whitespace-only value clears the logo
 * (`null`); a present value must be HTTPS on `*.supabase.co` or
 * `*.fal.ai`, mirroring `next.config.ts` `images.remotePatterns` —
 * `logoUrl` is rendered through `next/image` on the lookbook cover and
 * sign-off pages, and an off-allowlist URL would throw at render time.
 */
const logoUrlSchema = z
  .string()
  .max(2048, { message: "Logo URL must be 2,048 characters or fewer" })
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .refine(
    (value) => {
      if (value === null) return true;
      try {
        const url = new URL(value);
        return url.protocol === "https:" && IMAGE_HOST_PATTERN.test(url.hostname);
      } catch {
        return false;
      }
    },
    {
      message:
        "Logo URL must be https with host *.supabase.co or *.fal.ai (per next.config.ts images.remotePatterns)",
    }
  );

/**
 * Zod schema for the /settings form payload accepted by the
 * `updateUserSettings` server action.
 *
 * Purpose: validates and normalizes the five editable `User` fields
 * (`firmName`, `ownerName`, `logoUrl`, `psychologyPageContent`,
 * `signoffContent`) so only allowlisted fields are ever written.
 * `.strict()` rejects unknown keys outright.
 *
 * Contract: `firmName`/`ownerName` are required non-empty (trimmed);
 * the three optional fields normalize blank input to `null` (column
 * cleared). `logoUrl` must satisfy the next/image host allowlist when
 * present. Output type has `logoUrl: string | null` etc.; the input
 * type (what the client form sends) is all strings.
 *
 * Side effects: none — pure validation; no env vars needed.
 */
export const settingsSchema = z
  .object({
    firmName: requiredTextSchema("Firm name"),
    ownerName: requiredTextSchema("Owner name"),
    logoUrl: logoUrlSchema,
    psychologyPageContent: optionalTextSchema,
    signoffContent: optionalTextSchema,
  })
  .strict();

/** The validated shape written to the `User` row ({@link settingsSchema}). */
export type SettingsOutput = z.output<typeof settingsSchema>;

/** The payload shape the client form sends ({@link settingsSchema}). */
export type SettingsInput = z.input<typeof settingsSchema>;
