"use client";

import { cn } from "@/lib/utils";

/**
 * ComparisonPill — styled label pill for before/after image comparison UI.
 *
 * Issue #644: "Before pill tag styling"
 *
 * Two variants:
 * - 'studio'  — Brush Refinement Studio (Screen 3): dark bg, white text
 *                Maps to Stitch --primary-container (#1c1b1a) via Atelier --primary
 * - 'report'  — Lookbook report (Screen 4): warm cream bg, taupe text, subtle border
 *                Maps to Stitch surface-container-lowest via Atelier --color-surface
 *
 * For the "After" pill in report context, use the 'after' variant (terracotta).
 */
export function ComparisonPill({
  variant = "studio",
  children,
  className,
  showDot = false,
}: {
  variant?: "studio" | "report" | "after";
  children: React.ReactNode;
  className?: string;
  /** Render a terracotta dot prefix before the label (used for "After" pill in report context). */
  showDot?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 label-sm font-semibold uppercase tracking-wider";
  const studio =
    "bg-primary text-primary-foreground"; /* #181716 bg, #ffffff text */
  const report =
    "bg-surface text-outline border border-outline/30"; /* #fff8f4 bg, #8C827A text */
  /* After pill: terracotta secondary */
  const after = "bg-secondary text-secondary-foreground"; /* #8f4d20 bg, #ffffff text */

  return (
    <span
      className={cn(
        base,
        variant === "studio" ? studio : variant === "after" ? after : report,
        className
      )}
    >
      {showDot && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-secondary flex-shrink-0"
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
