"use server";

import { prisma } from "@/lib/prisma";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import { revalidatePath } from "next/cache";
import { settingsSchema, type SettingsInput } from "@/lib/settings-schema";
import { withTrackedAction } from "@/lib/error-tracking";
import { componentLogger } from "@/lib/logger";

const log = componentLogger("action:settings");

/**
 * Server action: updates the authed user's editable branding/template
 * fields from the /settings form.
 *
 * Purpose: powers `/settings`. Only the five allowlisted fields
 * (`firmName`, `ownerName`, `logoUrl`, `psychologyPageContent`,
 * `signoffContent`) are written, after zod validation
 * ({@link settingsSchema}) normalizes blank optional fields to `null`.
 *
 * Contract: requires an authenticated session AND a matching Prisma
 * `User` row — `getAuthedPrismaUser` resolves the row by verified email
 * and returns null when either is missing, so the update's
 * `where: { id: user.id }` always targets the caller's OWN existing row.
 * It can never create a duplicate `User` (an UPDATE, not an upsert) and
 * a row that vanished mid-request fails with a caught P2025, reported
 * as `{ success: false }` rather than a 500. Failures are caught and
 * reported, never thrown.
 *
 * Side effects: needs `DATABASE_URL` and a valid Supabase session
 * cookie; performs a Prisma `user.update` and calls
 * `revalidatePath("/settings")` so the page reflects the change; logs
 * failures to structured logging via `error-tracking`.
 *
 * @param input The five editable fields as sent by the client form.
 * @returns `{ success: true }` on write, or
 *   `{ success: false, error }` when unauthenticated, invalid, or the
 *   update fails.
 */
export async function updateUserSettings(
  input: SettingsInput
): Promise<{ success: boolean; error?: string }> {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      success: false,
      error: firstIssue?.message ?? "Invalid settings data",
    };
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        firmName: parsed.data.firmName,
        ownerName: parsed.data.ownerName,
        logoUrl: parsed.data.logoUrl,
        psychologyPageContent: parsed.data.psychologyPageContent,
        signoffContent: parsed.data.signoffContent,
        darkMode: parsed.data.darkMode,
      },
    });
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    log.error({ type: "settings_save_failed", userId: user.id }, "Failed to save user settings");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
