/**
 * Issue #612: 4-step Atelier Canvas studio workflow — step definitions.
 *
 * The studio pipeline that runs from consultation intake to client report:
 *
 *  1. Client Project Setup  — /projects/[id]/setup
 *  2. Room Batch Stage      — /projects/[id]/rooms
 *  3. Brush Refinement      — /projects/[id]/refine
 *  4. Consultation Report   — /projects/[id]/report
 *
 * Pure data + path/step resolution so the stepper header, the Step 1
 * "proceed" CTA, and the Step 2 "send to refinement" CTA all agree on the
 * same step graph — pinned 1:1 by tests/studio-workflow.test.ts (same
 * pattern as lib/auth-redirect.ts).
 */

/** Route segment + step id in one: the segment IS the step id. */
export type StudioStepId = "setup" | "rooms" | "refine" | "report";

export interface StudioStep {
  id: StudioStepId;
  /** 1-based step number shown in the stepper. */
  index: number;
  /** Short label for the stepper chip (spec wording). */
  shortLabel: string;
  /** Full screen title. */
  title: string;
}

/** The four steps, in pipeline order. */
export const STUDIO_STEPS: readonly StudioStep[] = [
  {
    id: "setup",
    index: 1,
    shortLabel: "Client Setup",
    title: "Client Project Setup",
  },
  {
    id: "rooms",
    index: 2,
    shortLabel: "Room Batch",
    title: "Room Batch Stage & AI Generation Studio",
  },
  {
    id: "refine",
    index: 3,
    shortLabel: "Brush Refinement",
    title: "Brush Refinement Studio",
  },
  {
    id: "report",
    index: 4,
    shortLabel: "Report & Export",
    title: "Client Consultation Report & Export",
  },
] as const;

/** Builds the href for one step of a project's workflow. */
export function studioStepHref(
  projectId: string,
  stepId: StudioStepId
): string {
  return `/projects/${projectId}/${stepId}`;
}

/**
 * Resolves the active studio step from a pathname. Matches exactly
 * `/projects/{id}/{setup|rooms|refine|report}` (trailing slash tolerated);
 * anything else — including `/projects/{id}` itself, `/projects/new`, or a
 * deeper path like `/projects/{id}/rooms/extra` — resolves to null so the
 * stepper simply doesn't render outside the workflow.
 */
export function resolveStudioStepFromPath(
  pathname: string
): StudioStepId | null {
  const match = /^\/projects\/([^/]+)\/(setup|rooms|refine|report)\/?$/.exec(
    pathname
  );
  return match ? (match[2] as StudioStepId) : null;
}

/** The step that follows the given one, or null on the last step. */
export function nextStudioStep(stepId: StudioStepId): StudioStepId | null {
  const index = STUDIO_STEPS.findIndex((step) => step.id === stepId);
  if (index === -1 || index === STUDIO_STEPS.length - 1) return null;
  return STUDIO_STEPS[index + 1].id;
}

/** The step that precedes the given one, or null on the first step. */
export function previousStudioStep(stepId: StudioStepId): StudioStepId | null {
  const index = STUDIO_STEPS.findIndex((step) => step.id === stepId);
  if (index <= 0) return null;
  return STUDIO_STEPS[index - 1].id;
}

/* ------------------------------------------------------------------ */
/* Step 1 form data — Staging Scope Matrix + Primary Consultation Goal */
/* ------------------------------------------------------------------ */

export type StudioScopeId =
  | "full-5-room"
  | "light-refresh"
  | "virtual-declutter";

export interface StudioScopeOption {
  id: StudioScopeId;
  label: string;
  description: string;
}

/** Staging Scope Matrix radio options (Step 1 spec). */
export const STUDIO_SCOPE_OPTIONS: readonly StudioScopeOption[] = [
  {
    id: "full-5-room",
    label: "Full 5-Room Staging",
    description: "Complete vignette staging across the five core listing zones",
  },
  {
    id: "light-refresh",
    label: "Light Refresh",
    description: "Curb-appeal touch-ups and key-zone accents only",
  },
  {
    id: "virtual-declutter",
    label: "Virtual Declutter + Furniture",
    description: "AI declutter with virtual furnishings, no physical install",
  },
] as const;

export type StudioGoalId = "client-pitch" | "listing-deck" | "mls-renders";

export interface StudioGoalOption {
  id: StudioGoalId;
  label: string;
  description: string;
}

/** Primary Consultation Goal toggle options (Step 1 spec). */
export const STUDIO_GOAL_OPTIONS: readonly StudioGoalOption[] = [
  {
    id: "client-pitch",
    label: "Client Pitch",
    description: "Win the engagement with a bold before/after narrative",
  },
  {
    id: "listing-deck",
    label: "Listing Deck",
    description: "Slideshow-ready spreads for the listing presentation",
  },
  {
    id: "mls-renders",
    label: "MLS Renders",
    description: "Photo-compliant renders sized for MLS upload",
  },
] as const;

export interface StudioDirectiveSummaryInput {
  /** Selected moodboard theme name (e.g. "Warm Organic Modern"). */
  themeName?: string | null;
  /** Selected staging scope, if any. */
  scope?: StudioScopeId | null;
  /** Selected consultation goal, if any. */
  goal?: StudioGoalId | null;
  /** AI micro-parameter slider values from the moodboard selector. */
  microParameters?: { preservationStrictness: number; foliageFill: number };
}

/**
 * Composes the Step 1 intake selections into the project-level
 * `stagingDirectives` string persisted on proceed/draft-save. Only the
 * pieces the user actually chose are included; an entirely unconfigured
 * form yields an empty string (so an existing directives value can be
 * preserved by the caller).
 */
export function buildStudioDirectivesSummary(
  input: StudioDirectiveSummaryInput
): string {
  const parts: string[] = [];

  if (input.themeName) {
    parts.push(`Aesthetic: ${input.themeName}`);
  }
  if (input.scope) {
    const scope = STUDIO_SCOPE_OPTIONS.find((option) => option.id === input.scope);
    if (scope) parts.push(`Scope: ${scope.label}`);
  }
  if (input.goal) {
    const goal = STUDIO_GOAL_OPTIONS.find((option) => option.id === input.goal);
    if (goal) parts.push(`Goal: ${goal.label}`);
  }
  if (input.microParameters) {
    const { preservationStrictness, foliageFill } = input.microParameters;
    parts.push(
      `Preservation strictness ${preservationStrictness}, foliage fill ${foliageFill}`
    );
  }

  return parts.join(" · ");
}
