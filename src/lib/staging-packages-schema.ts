/**
 * Staging Package Tiers — data definitions (issue #555).
 *
 * Defines the three pricing bundles shown as selectable cards in the new-project
 * flow and the project detail view. `id` is stored in the Project model.
 */

export const STAGING_PACKAGES = [
  {
    id: "essential",
    name: "Essential",
    rooms: 2,
    price: 12000,
    includes: ["Living", "Dining"],
    recommended: false,
  },
  {
    id: "premium",
    name: "Premium",
    rooms: 4,
    price: 28000,
    includes: ["Living", "Dining", "Master", "Guest"],
    recommended: true,
  },
  {
    id: "turnkey",
    name: "Turnkey",
    rooms: "All",
    price: 45000,
    includes: ["Full delivery", "Pickup"],
    recommended: false,
  },
] as const;

export type StagingPackageId = (typeof STAGING_PACKAGES)[number]["id"];

export interface StagingPackage {
  id: string;
  name: string;
  rooms: number | "All";
  price: number;
  includes: readonly string[];
  recommended: boolean;
}

/** Returns the package definition for a given id, or null if not found. */
export function getStagingPackage(id: string): StagingPackage | null {
  return STAGING_PACKAGES.find((p) => p.id === id) ?? null;
}

/** Formats price as a USD string, e.g. 12000 → "$12,000". */
export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents);
}
