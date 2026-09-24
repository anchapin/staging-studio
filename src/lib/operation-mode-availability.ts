// Issue #692: availability map for the inpaint operation-mode tabs.
// Relight, Material Swap, and Restore Original have no API endpoints yet
// (#629 follow-up: /api/relight, /api/material-swap, /api/restore-original),
// so their tabs render visibly disabled with a "Coming soon" badge instead
// of firing placeholder toasts. Only modes marked available here may be
// activated — tab clicks and programmatic targets (collapsed-inspector
// rail) both gate through isOperationModeAvailable.

/** The four inpaint operation modes (issue #629). */
export const INPAINT_OPERATION_MODE_IDS = [
  "inpaint-zone",
  "restore-original",
  "relight",
  "material-swap",
] as const;

export type InpaintOperationModeId = (typeof INPAINT_OPERATION_MODE_IDS)[number];

export interface OperationModeAvailability {
  /** Whether the mode is wired to a real API endpoint and fully interactive. */
  available: boolean;
  /** Badge copy surfaced on the tab for modes that are not yet available. */
  badge?: string;
}

/** Badge shown on tabs whose backend is not shipped yet (issue #692). */
export const COMING_SOON_BADGE = "Coming soon";

export const INPAINT_OPERATION_MODE_AVAILABILITY: Record<
  InpaintOperationModeId,
  OperationModeAvailability
> = {
  "inpaint-zone": { available: true },
  "restore-original": { available: false, badge: COMING_SOON_BADGE },
  relight: { available: false, badge: COMING_SOON_BADGE },
  "material-swap": { available: false, badge: COMING_SOON_BADGE },
};

/**
 * Issue #692: gates operation-mode activation to shipped modes only.
 * Fails closed for unknown ids.
 */
export function isOperationModeAvailable(mode: InpaintOperationModeId): boolean {
  return INPAINT_OPERATION_MODE_AVAILABILITY[mode]?.available ?? false;
}
