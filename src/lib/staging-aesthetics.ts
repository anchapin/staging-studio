/** Shared constants for staging aesthetics — used across project creation,
 * project detail view, and the global staging directives bar. */
export const STAGING_AESTHETICS = [
  "Organic Modern Luxury",
  "Warm Transitional",
  "Coastal Minimal",
  "Urban Industrial",
  "Classic Elegant",
] as const;

export type StagingAesthetic = (typeof STAGING_AESTHETICS)[number];
