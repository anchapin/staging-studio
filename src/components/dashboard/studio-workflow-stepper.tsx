"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STUDIO_STEPS,
  studioStepHref,
  type StudioStepId,
} from "@/lib/studio-workflow";

interface StudioWorkflowStepperProps {
  projectId: string;
  /** The step whose screen is rendered — gets `aria-current="step"`. */
  activeStep: StudioStepId;
  className?: string;
}

/**
 * Issue #612: header stepper nav for the 4-step Atelier Canvas studio
 * workflow. Renders the pipeline (Client Setup → Room Batch → Brush
 * Refinement → Report & Export) as a horizontal chip rail: completed
 * steps get a terracotta check, the active step the filled
 * `bg-primary` chip with `aria-current="step"`, upcoming steps stay
 * muted. Every chip links to its step route so the pipeline is
 * navigable from any screen. Styled with the warm atelier tokens
 * (issue #613): `surface-container-lowest` surface, hairline
 * `outline-variant` dividers, Plus Jakarta labels + JetBrains Mono
 * step numerals (issue #614).
 */
export function StudioWorkflowStepper({
  projectId,
  activeStep,
  className,
}: StudioWorkflowStepperProps) {
  const activeIndex =
    STUDIO_STEPS.find((step) => step.id === activeStep)?.index ?? 1;

  return (
    <nav aria-label="Studio workflow steps" className={className}>
      <ol className="flex flex-wrap items-center gap-2">
        {STUDIO_STEPS.map((step) => {
          const isActive = step.id === activeStep;
          const isCompleted = step.index < activeIndex;

          return (
            <li key={step.id} className="flex items-center gap-2">
              <Link
                href={studioStepHref(projectId, step.id)}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium font-jakarta transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : isCompleted
                      ? "border-secondary/50 bg-secondary/10 text-foreground hover:bg-secondary/20"
                      : "border-outline-variant/40 bg-surface-container-lowest text-muted-foreground hover:border-outline-variant hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10px] tabular-nums",
                    isActive
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : isCompleted
                        ? "bg-secondary text-white"
                        : "bg-surface-container text-muted-foreground"
                  )}
                  aria-hidden="true"
                >
                  {isCompleted ? <Check className="h-3 w-3" /> : step.index}
                </span>
                {step.shortLabel}
              </Link>
              {step.index < STUDIO_STEPS.length && (
                <span
                  className="h-px w-4 bg-outline-variant/50"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
