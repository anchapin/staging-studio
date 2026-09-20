import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Badge variants using design tokens for semantic meaning.
 *
 * Variants:
 * - default: Secondary background, muted text — neutral status
 * - success: Green semantic — completion, confirmed, active
 * - warning: Amber semantic — attention, pending, in progress
 * - destructive: Red semantic — errors, critical, rejected
 * - outline: Border-only variant — secondary actions, filters
 * - secondary: Muted background — disabled, inactive states
 *
 * Sizes:
 * - default: Standard badge (h-5, text-xs)
 * - sm: Compact badge (h-4, text-[10px])
 * - lg: Large badge (h-6, text-sm)
 *
 * Accessibility:
 * - Uses <span> with no implicit role — relies on context
 * - For status indicators, prefer pairing with aria-label or sr-only text
 * - Color is NOT the sole indicator — all variants have distinct silhouettes
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-md font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        default:
          "border border-transparent bg-secondary text-secondary-foreground shadow-sm dark:bg-secondary/80 dark:text-secondary-foreground",
        success:
          "border border-transparent bg-success/10 text-success dark:bg-success/20 dark:text-success/90",
        warning:
          "border border-transparent bg-warning/10 text-warning dark:bg-warning/20 dark:text-warning/90",
        destructive:
          "border border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive/90",
        outline:
          "border border-border bg-transparent text-foreground dark:border-input dark:bg-transparent dark:text-foreground",
        secondary:
          "border border-transparent bg-muted text-muted-foreground dark:bg-muted/80 dark:text-muted-foreground",
      },
      size: {
        default: "h-5 px-2 py-0.5 text-xs",
        sm: "h-4 px-1.5 py-0 text-[10px]",
        lg: "h-6 px-2.5 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Accessibility: label for screen readers when color is sole indicator */
  "aria-label"?: string
}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
