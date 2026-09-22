/**
 * Engagement Tier data for the Client Consultation Report (issue #626).
 */

export interface EngagementTier {
  id: string;
  name: string;
  tagline: string;
  price: number | null; // null means "Custom Quote"
  cta: string;
  recommended: boolean;
  includes: readonly string[];
}

export const ENGAGEMENT_TIERS: EngagementTier[] = [
  {
    id: "essential-virtual",
    name: "Essential Virtual",
    tagline: "Virtual Declutter + AI Staging",
    price: 299,
    cta: "Select Essential",
    recommended: false,
    includes: [
      "Virtual declutter consultation",
      "AI-powered room staging renders",
      "2 revision rounds",
      "Digital delivery within 5 days",
    ],
  },
  {
    id: "full-immersive",
    name: "Full Immersive",
    tagline: "Complete Staging Package",
    price: 1199,
    cta: "Select Immersive",
    recommended: true,
    includes: [
      "Full home staging consultation",
      "AI-powered room staging renders",
      "Unlimited revision rounds",
      "Priority turnaround (3 days)",
      "Material swatch recommendations",
      "Furniture procurement guide",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise / Portfolio",
    tagline: "Multi-Property Portfolio",
    price: null,
    cta: "Contact Studio",
    recommended: false,
    includes: [
      "Unlimited property portfolio",
      "Dedicated staging director",
      "Custom timeline & pricing",
      "White-glove concierge service",
    ],
  },
];

export function formatEngagementPrice(price: number | null): string {
  if (price === null) return "Custom Quote";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(price);
}
