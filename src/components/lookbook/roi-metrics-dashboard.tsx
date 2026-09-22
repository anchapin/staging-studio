import { TrendingUp, Clock, DollarSign } from "lucide-react";
import type { ROIMetric } from "./types";
import { ProposalFooter } from "./proposal-footer";

interface ROIMetricsDashboardProps {
  metrics?: ROIMetric[];
}

const ICONS = {
  trending_up: TrendingUp,
  clock: Clock,
  dollar: DollarSign,
} as const;

const DEFAULT_METRICS: ROIMetric[] = [
  {
    value: "+8–12%",
    title: "Estimated Sales Price Premium",
    description:
      "Generates $480k–$720k equity over vacant baseline based on comparable staged properties in District 7.",
    icon: "trending_up",
  },
  {
    value: "24 Days",
    title: "Faster Transaction Velocity",
    description:
      "62% fewer price adjustments in District 7. Staged homes sell faster with fewer listing price reductions.",
    icon: "clock",
  },
  {
    value: "$45,000",
    title: "Recommended Investment Tier",
    description:
      "Turnkey physical delivery across 4 zones — furniture placement, artwork, and finishing touches included.",
    icon: "dollar",
  },
];

export function ROIMetricsDashboard({
  metrics = DEFAULT_METRICS,
}: ROIMetricsDashboardProps) {
  return (
    <div className="lookbook-page min-h-screen flex flex-col items-center justify-between bg-stone-50 p-12">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="max-w-4xl w-full space-y-8">
          {/* Section header */}
          <div className="text-center space-y-3">
            <p className="font-cinzel text-sm tracking-[0.3em] uppercase text-muted-foreground">
              ROI Metrics Dashboard
            </p>
            <h2 className="font-playfair text-4xl font-bold text-foreground">
              The Value of Staging
            </h2>
            <div className="w-24 h-0.5 bg-primary mx-auto" />
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {metrics.map((metric, index) => {
              const Icon = ICONS[metric.icon];
              return (
                <div
                  key={index}
                  className="group relative flex flex-col items-center text-center p-6 bg-white rounded-lg border border-border hover:border-primary transition-colors duration-200 cursor-default"
                >
                  {/* Icon */}
                  <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mb-4 group-hover:bg-primary/20 group-hover:border-primary/50 transition-colors duration-200">
                    <Icon className="w-6 h-6 text-primary" aria-hidden="true" />
                  </div>

                  {/* Value */}
                  <p className="font-playfair text-4xl font-bold text-foreground mb-1">
                    {metric.value}
                  </p>

                  {/* Title */}
                  <p className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground mb-3">
                    {metric.title}
                  </p>

                  {/* Description */}
                  <p className="font-jakarta text-sm text-muted-foreground leading-relaxed">
                    {metric.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ProposalFooter />
    </div>
  );
}
