import type { BuyerDemographics, LookbookRoomData } from "./types";

interface BuyerPersonaPageProps {
  buyerDemographics: BuyerDemographics;
  user: LookbookRoomData["user"];
  project: LookbookRoomData["project"];
}

// Lookup tables for human-readable labels
const BUYER_TYPE_LABELS: Record<string, string> = {
  young_professional: "Young Professional",
  growing_family: "Growing Family",
  downsizing_retiree: "Downsizing Retiree",
  investor: "Investor",
  luxury_buyer: "Luxury Buyer",
  first_time_homebuyer: "First-Time Homebuyer",
  serial_renovator: "Serial Renovator",
};

const DESIGN_PREFERENCE_LABELS: Record<string, string> = {
  contemporary: "Contemporary",
  traditional: "Traditional",
  minimalist: "Minimalist",
  maximalist: "Maximalist",
  coastal: "Coastal",
  industrial: "Industrial",
  midcentury_modern: "Mid-Century Modern",
  scandinavian: "Scandinavian",
  bohemian: "Bohemian",
  transitional: "Transitional",
};

const MUST_HAVE_FEATURE_LABELS: Record<string, string> = {
  home_office: "Home Office",
  open_plan: "Open Plan",
  outdoor_space: "Outdoor Space",
  gourmet_kitchen: "Gourmet Kitchen",
  master_suite: "Master Suite",
  smart_home: "Smart Home",
  energy_efficient: "Energy Efficient",
  multigenerational: "Multigenerational",
  home_gym: "Home Gym",
  pet_friendly: "Pet-Friendly",
};

const SELL_TIMELINE_LABELS: Record<string, string> = {
  under_30_days: "Under 30 Days",
  "30_60_days": "30 – 60 Days",
  "60_90_days": "60 – 90 Days",
  over_90_days: "Over 90 Days",
};

function formatBudget(min: number, max: number): string {
  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(0)}M` : `$${n}k`;
  return `${fmt(min)} – ${fmt(max)}`;
}

export function BuyerPersonaPage({
  buyerDemographics,
  user,
  project,
}: BuyerPersonaPageProps) {
  const { buyerType, designPreferences, budgetMin, budgetMax, mustHaveFeatures, sellTimeline } =
    buyerDemographics;

  return (
    <div className="lookbook-page min-h-screen flex flex-col items-center justify-center bg-stone-50 p-12">
      <div className="max-w-4xl w-full space-y-8">
        {/* Section header */}
        <div className="text-center space-y-3">
          <p className="font-cinzel text-sm tracking-[0.3em] uppercase text-muted-foreground">
            Buyer Persona Summary
          </p>
          <h2 className="font-playfair text-4xl font-bold text-foreground">
            Meet the Buyer
          </h2>
          <div className="w-24 h-0.5 bg-primary mx-auto" />
        </div>

        {/* Primary buyer profile card */}
        <div className="bg-white rounded-lg border border-border p-8 text-center">
          <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-3">
            Primary Buyer Profile
          </p>
          <p className="font-playfair text-3xl font-bold text-foreground">
            {BUYER_TYPE_LABELS[buyerType] ?? buyerType}
          </p>
          <p className="font-jakarta text-muted-foreground mt-2">
            {project.targetBuyer}
          </p>
        </div>

        {/* Two-column grid: design preferences + sell timeline */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Design Preferences */}
          <div className="bg-white rounded-lg border border-border p-6">
            <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-4">
              Design Preferences
            </p>
            <div className="flex flex-wrap gap-2">
              {designPreferences.map((pref) => (
                <span
                  key={pref}
                  className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-jakarta text-primary border border-primary/20"
                >
                  {DESIGN_PREFERENCE_LABELS[pref] ?? pref}
                </span>
              ))}
            </div>
          </div>

          {/* Sell Timeline */}
          <div className="bg-white rounded-lg border border-border p-6">
            <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-4">
              Timeline to Sell
            </p>
            <p className="font-playfair text-2xl font-bold text-foreground">
              {SELL_TIMELINE_LABELS[sellTimeline] ?? sellTimeline}
            </p>
          </div>
        </div>

        {/* Budget Range */}
        <div className="bg-white rounded-lg border border-border p-6">
          <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-4">
            Budget Range
          </p>
          <p className="font-playfair text-3xl font-bold text-foreground">
            {formatBudget(budgetMin, budgetMax)}
          </p>
        </div>

        {/* Must-Have Features */}
        <div className="bg-white rounded-lg border border-border p-6">
          <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-4">
            Must-Have Features
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {mustHaveFeatures.map((feature) => (
              <div key={feature} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                <span className="font-jakarta text-sm text-foreground">
                  {MUST_HAVE_FEATURE_LABELS[feature] ?? feature}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-4">
          <p className="font-cinzel text-xs tracking-widest text-muted-foreground">
            {user.firmName}
          </p>
        </div>
      </div>
    </div>
  );
}
