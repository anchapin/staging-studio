import { STAGING_AESTHETICS } from "@/lib/staging-aesthetics";

/**
 * Issue #1189: the project aesthetic is the single source of truth.
 *
 * Rooms have no aesthetic of their own: `Room` has no aesthetic column and
 * every generation path reads `Project.stagingAesthetic`. These helpers keep
 * the project page honest about that.
 */

export const PROJECT_AESTHETIC_LABEL = "Project aesthetic";
export const PROJECT_AESTHETIC_HELPER = "Every room is staged in this style.";
export const BULK_AESTHETIC_NOTE =
  "Aesthetic applies to the whole project. Change it under Project aesthetic.";
export const AESTHETIC_NOT_SET = "Not set";

/** The aesthetic a room will be staged in. Precedence today: project only. */
export function resolveRoomAesthetic(project: { stagingAesthetic: string | null | undefined }): string {
  return (project.stagingAesthetic ?? "").trim();
}

/** Header badge text, e.g. "Project aesthetic: Vintage Modern". */
export function projectAestheticBadge(aesthetic: string | null | undefined): string {
  const value = (aesthetic ?? "").trim();
  return `${PROJECT_AESTHETIC_LABEL}: ${value || AESTHETIC_NOT_SET}`;
}

/**
 * Dropdown options. A saved aesthetic outside the preset list (e.g. the demo
 * project's "Vintage Modern") is kept first, so the control shows the real
 * value instead of falling back to blank.
 */
export function aestheticOptions(current: string | null | undefined): string[] {
  const value = (current ?? "").trim();
  const presets: string[] = [...STAGING_AESTHETICS];
  return value && !presets.includes(value) ? [value, ...presets] : presets;
}
