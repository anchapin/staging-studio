import type { ROIMetric } from "./types";
import { ProposalFooter } from "./proposal-footer";

interface ROIMetricsDashboardProps {
  metrics?: ROIMetric[];
}

const ICON_NAMES = {
  trending_up: "trending_up",
  clock: "schedule",
  dollar: "paid",
} as const;

const DEFAULT_METRICS: ROIMetric[] = [
  {
    value: "+8–12%",
    title: "Price Premium",
    description: "Above As-Is Appraisal",
    icon: "trending_up",
  },
  {
    value: "24 Days",
    title: "Faster Sale Velocity",
    description: "vs. 43 Day Market Average",
    icon: "clock",
  },
  {
    value: "$45K",
    title: "Avg. Staging Premium",
    description: "Per $1 Invested in Staging",
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
              Executive ROI Metrics
            </p>
            <h2 className="font-playfair text-4xl font-bold text-foreground">
              The Value of Staging
            </h2>
            <div className="w-24 h-0.5 bg-primary mx-auto" />
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {metrics.map((metric, index) => {
              const iconName = ICON_NAMES[metric.icon];
              const isFirstCard = index === 0;
              return (
                <div
                  key={index}
                  className="group relative flex flex-col items-center text-center p-5 rounded-xl cursor-default"
                  style={{
                    background:
                      "linear-gradient(to bottom, var(--color-surface-container), var(--color-surface-container-low))",
                    borderWidth: "1px",
                    borderStyle: "solid",
                    borderColor: isFirstCard
                      ? "color-mix(in oklch, var(--color-tertiary) 20%, transparent)"
                      : "color-mix(in oklch, var(--color-secondary) 20%, transparent)",
                  }}
                >
                  {/* Icon */}
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
                    style={{ backgroundColor: "color-mix(in oklch, var(--color-secondary) 10%, transparent)" }}
                    aria-hidden="true"
                  >
                    <span
                      className="material-symbols-outlined icon-md"
                      style={{
                        fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24",
                        color: "var(--color-secondary)",
                      }}
                    >
                      {iconName}
                    </span>
                  </div>

                  {/* Value */}
                  <p className="font-playfair text-4xl font-bold text-foreground mb-1">
                    {metric.value}
                  </p>

                  {/* Label */}
                  <p className="font-jakarta text-sm text-muted-foreground mb-1">
                    {metric.title}
                  </p>

                  {/* Subtext */}
                  <p
                    className="font-jakarta text-xs"
                    style={{ color: "var(--color-tertiary)" }}
                  >
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
