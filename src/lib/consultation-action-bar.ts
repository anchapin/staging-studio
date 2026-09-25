/**
 * Issue #619: Sticky bottom consultation action bar (Client Project Setup — Step 1).
 *
 * Pure presentation logic for the fixed bottom bar on the new-project screen:
 * position/surface/padding class constants, the frosted glassmorphic inner
 * layout, the pulsing status dot, the CTA button treatments, and the
 * configuration-summary resolver that renders the "Configured: [Name]" label.
 *
 * Class-name constants live here so tests can pin the exact utilities the
 * component renders (same pattern as lib/workbench-layout.ts, issue #620).
 * Pinned 1:1 by tests/consultation-action-bar.test.ts.
 */

/** Bar position: pinned to the viewport bottom, below content, under overlays. */
export const CONSULTATION_BAR_POSITION_CLASSES =
  "fixed bottom-0 left-0 right-0 z-40";

/**
 * Frosted glassmorphic surface: low-opacity surface container over a backdrop
 * blur, separated from the page by a hairline `outline-variant` top border.
 */
export const CONSULTATION_BAR_SURFACE_CLASSES =
  "border-t border-outline-variant/30 bg-surface-container-lowest/90 backdrop-blur-md shadow-lg";

/** Bar padding (spec: `px-6 py-3.5`). */
export const CONSULTATION_BAR_PADDING_CLASSES = "px-6 py-3.5";

/**
 * Inner content constraint: matches the main content width. Clusters stack
 * vertically on mobile and spread to the edges from `sm` up.
 */
export const CONSULTATION_BAR_INNER_CLASSES =
  "mx-auto flex max-w-[1560px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between";

/** Vertical divider between the config line and the descriptive subtext. */
export const CONSULTATION_BAR_DIVIDER_CLASSES =
  "hidden sm:block h-8 w-px shrink-0 bg-outline-variant/30";

/** Pulsing status dot: terracotta core on an expanding ping halo. */
export const CONSULTATION_PULSE_DOT_CORE_CLASSES =
  "relative inline-flex h-2.5 w-2.5 rounded-full bg-secondary animate-pulse";

/** The `animate-ping` halo layered behind the dot core. */
export const CONSULTATION_PULSE_DOT_HALO_CLASSES =
  "absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary opacity-75";

/**
 * Primary CTA ("Save & Proceed"): primary fill that hovers to the terracotta
 * secondary, 150ms transition, with a 0.98 press-scale (issue #642 family).
 * Applied on top of the default Button variant.
 */
export const CONSULTATION_PRIMARY_CTA_CLASSES =
  "bg-primary hover:bg-secondary transition-colors duration-150 active:scale-[0.98]";

/** Ghost CTA ("Save Draft"): bordered, hover bg change, full-width on mobile. */
export const CONSULTATION_GHOST_CTA_CLASSES =
  "border border-outline-variant/50 bg-transparent hover:bg-surface-container-low";

/** CTAs take full width on mobile and size to content from `sm` up. */
export const CONSULTATION_CTA_WIDTH_CLASSES = "w-full sm:w-auto";

/** Descriptive subtext under the config line (hidden on mobile). */
export const CONSULTATION_SUBTEXT_CLASSES =
  "hidden sm:block max-w-md truncate text-sm text-muted-foreground";

/** Fixed subtext copy from the Screen 1 spec. */
export const CONSULTATION_BAR_SUBTEXT =
  "Ready to ingest raw floor scan photographs and 360 pano captures.";

/** Fallback summary while nothing is configured yet. */
export const CONSULTATION_CONFIG_UNCONFIGURED_LABEL =
  "No configuration selected";

/**
 * Builds the bold configuration summary shown next to "Configured:".
 *
 * Mirrors the Screen 1 example "Warm Organic Modern (Full 5-room Staging)":
 * the staging aesthetic as the lead name, with a parenthesized descriptor
 * derived from the staging package and room count. Falls back through
 * aesthetic → package name → the unconfigured label.
 */
export function consultationConfigSummary(input: {
  aesthetic?: string | null;
  packageName?: string | null;
  roomCount?: number | null;
}): string {
  const aesthetic = input.aesthetic?.trim() || "";
  const packageName = input.packageName?.trim() || "";
  const roomCount =
    typeof input.roomCount === "number" && input.roomCount > 0
      ? input.roomCount
      : null;

  if (!aesthetic && !packageName && !roomCount) {
    return CONSULTATION_CONFIG_UNCONFIGURED_LABEL;
  }

  const descriptorParts: string[] = [];
  if (packageName.toLowerCase() === "turnkey") {
    descriptorParts.push("Full");
  }
  if (packageName) {
    descriptorParts.push(packageName);
  }
  if (roomCount) {
    descriptorParts.push(`${roomCount}-room`);
  }

  const descriptor = descriptorParts.length
    ? `${descriptorParts.join(" ")} Staging`
    : "";

  if (aesthetic) {
    return descriptor ? `${aesthetic} (${descriptor})` : aesthetic;
  }
  return descriptor || CONSULTATION_CONFIG_UNCONFIGURED_LABEL;
}
