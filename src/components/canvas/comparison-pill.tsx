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
}: {
  variant?: "studio" | "report" | "after";
  children: React.ReactNode;
  className?: string;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 label-sm font-semibold uppercase tracking-wider";
  const studio =
    "bg-primary text-primary-foreground"; /* #181716 bg, #fff8f8 text */
  const report =
    "bg-[#fff8f4] text-[#8C827A] border border-[#8C827A]/30";
  /* After pill: terracotta secondary */
  const after = "bg-secondary text-secondary-foreground"; /* #C47847 bg, #fff8f8 text */

  return (
    <span
      className={cn(
        base,
        variant === "studio" ? studio : variant === "after" ? after : report,
        className
      )}
    >
      {children}
    </span>
  );
}
