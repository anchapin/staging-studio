import { ProposalFooter } from "./proposal-footer";
import { STAGING_PACKAGES, getStagingPackage, formatPrice } from "@/lib/staging-packages-schema";

interface InvestmentSummaryPageProps {
  /** The selected staging package id, e.g. "premium" */
  stagingPackageId?: string | null;
  /** Number of rooms being staged in this project */
  roomCount?: number;
}

/** Lead time and delivery estimates per package tier */
const LEAD_TIME: Record<string, { setup: string; delivery: string }> = {
  essential: { setup: "2 weeks", delivery: "3–5 business days" },
  premium: { setup: "3 weeks", delivery: "5–7 business days" },
  turnkey: { setup: "4 weeks", delivery: "7–10 business days" },
};

/**
 * Lookbook Investment Summary page (issue #590).
 *
 * Displays the selected staging package tier with price, itemized scope of
 * delivery (rooms, zones, furniture pieces, finishing touches), and lead time
 * / delivery timeline.
 *
 * Inserted after `ROIMetricsDashboard` and before the room spreads / signoff.
 */
export function InvestmentSummaryPage({
  stagingPackageId,
  roomCount,
}: InvestmentSummaryPageProps) {
  // Fall back to the recommended (Premium) package when no selection is stored
  const pkg = stagingPackageId
    ? getStagingPackage(stagingPackageId)
    : STAGING_PACKAGES.find((p) => p.recommended) ?? null;

  const leadTimes = pkg ? LEAD_TIME[pkg.id] ?? LEAD_TIME.premium : LEAD_TIME.premium;

  // rooms being staged (fall back to the package's own room count)
  const roomsCovered = roomCount ?? (typeof pkg?.rooms === "number" ? pkg.rooms : null);

  return (
    <div className="lookbook-page min-h-screen flex flex-col items-center justify-between bg-stone-50 p-12">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="max-w-4xl w-full space-y-8">
          {/* Section header */}
          <div className="text-center space-y-3">
            <p className="font-cinzel text-sm tracking-[0.3em] uppercase text-muted-foreground">
              Investment Summary
            </p>
            <h2 className="font-playfair text-4xl font-bold text-foreground">
              Your Staging Investment
            </h2>
            <div className="w-24 h-0.5 bg-primary mx-auto" />
          </div>

          {/* Package tier + price hero */}
          <div className="flex flex-col items-center rounded-xl bg-white border border-border p-8 space-y-2 shadow-sm">
            <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground">
              Selected Package
            </p>
            <p className="font-playfair text-5xl font-bold text-foreground">
              {pkg?.name ?? "Premium"}
            </p>
            <p className="font-playfair text-3xl font-semibold text-primary">
              {pkg ? formatPrice(pkg.price) : formatPrice(28000)}
            </p>
            {pkg?.recommended && (
              <span className="inline-flex items-center gap-1.5 mt-1 px-3 py-0.5 bg-primary/10 border border-primary/30 rounded-full text-xs font-jakarta text-primary font-medium">
                Recommended
              </span>
            )}
          </div>

          {/* Scope grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Rooms covered */}
            <div className="flex flex-col rounded-xl bg-white border border-border p-6 shadow-sm">
              <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-3">
                Rooms Covered
              </p>
              <p className="font-playfair text-3xl font-bold text-foreground mb-1">
                {roomsCovered ?? 4}
              </p>
              <p className="font-jakarta text-sm text-muted-foreground">
                {pkg?.id === "turnkey"
                  ? "All rooms in the property"
                  : pkg?.id === "essential"
                  ? "Living + Dining"
                  : "Living, Dining, Master + Guest"}
              </p>
            </div>

            {/* Lead time */}
            <div className="flex flex-col rounded-xl bg-white border border-border p-6 shadow-sm">
              <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-3">
                Lead Time
              </p>
              <p className="font-playfair text-3xl font-bold text-foreground mb-1">
                {leadTimes.setup}
              </p>
              <p className="font-jakarta text-sm text-muted-foreground">
                From confirmed approval
              </p>
            </div>

            {/* Delivery timeline */}
            <div className="flex flex-col rounded-xl bg-white border border-border p-6 shadow-sm">
              <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-3">
                Delivery Timeline
              </p>
              <p className="font-playfair text-3xl font-bold text-foreground mb-1">
                {leadTimes.delivery}
              </p>
              <p className="font-jakarta text-sm text-muted-foreground">
                Furniture placement &amp; styling
              </p>
            </div>

            {/* Finishing touches */}
            <div className="flex flex-col rounded-xl bg-white border border-border p-6 shadow-sm">
              <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-3">
                Finishing Touches
              </p>
              <p className="font-playfair text-3xl font-bold text-foreground mb-1">Included</p>
              <p className="font-jakarta text-sm text-muted-foreground">
                Artwork, textiles, accessories &amp; styling
              </p>
            </div>
          </div>

          {/* Itemized scope list */}
          <div className="rounded-xl bg-white border border-border p-6 shadow-sm space-y-4">
            <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground">
              Package Includes
            </p>
            <ul className="space-y-2">
              {(pkg?.includes ?? ["Living", "Dining", "Master", "Guest"]).map((item) => (
                <li key={item} className="flex items-center gap-3 font-jakarta text-sm text-foreground">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                    <svg
                      className="w-3 h-3 text-primary"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <ProposalFooter />
    </div>
  );
}
