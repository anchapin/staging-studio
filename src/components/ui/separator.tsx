"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Separator — a semantic visual divider with structural and decorative variants.
 *
 * Variants:
 * - default: Solid line using --border token — for section breaks within cards
 * - muted: Dashed line using --muted token — for grouping within content areas
 * - subtle: Extra light using --accent — for subtle section dividers
 *
 * Orientations:
 * - horizontal: Full-width horizontal rule (default)
 * - vertical: Full-height vertical line for side-by-side layouts
 *
 * Accessibility:
 * - Renders as <hr> (horizontal) or <div> with role="separator" (vertical)
 * - Always decorative in visual use — no meaningful content in the separator itself
 * - Use aria-orientation for vertical separators
 * - For sections with headings, prefer visual spacing over decorative separators
 */
interface SeparatorProps extends React.HTMLAttributes<HTMLHRElement> {
  orientation?: "horizontal" | "vertical"
  /** Visual weight variant */
  variant?: "default" | "muted" | "subtle"
  /** Decorative only — removes semantic meaning for pure aesthetics */
  decorative?: boolean
}

const Separator = React.forwardRef<HTMLHRElement, SeparatorProps>(
  (
    {
      className,
      orientation = "horizontal",
      variant = "default",
      decorative = true,
      ...props
    },
    ref
  ) => {
    const isVertical = orientation === "vertical"

    return (
      <hr
        ref={ref}
        role={isVertical || decorative ? "separator" : undefined}
        aria-orientation={isVertical ? orientation : undefined}
        className={cn(
          // Base: shrink to avoid stretching, prevent selection
          "shrink-0 select-none",
          // Orientation-specific layout
          isVertical ? "h-full w-px" : "h-px w-full",
          // Variant styles
          variant === "default" && "bg-border",
          variant === "muted" && "border-muted border-dashed",
          variant === "subtle" && "bg-accent",
          className
        )}
        {...props}
      />
    )
  }
)
Separator.displayName = "Separator"

export { Separator }
export type { SeparatorProps }
