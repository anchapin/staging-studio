import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Visual error state — shows destructive border + ring */
  error?: boolean
}

/**
 * Design token-native input component with error, disabled, and focus states.
 *
 * Tokens used:
 * - --border: default border color
 * - --input: background color
 * - --foreground: text color
 * - --ring: focus ring color
 * - --destructive: error border/focus color
 * - --radius: border radius
 *
 * Accessibility:
 * - Native <input> element for screen reader compatibility
 * - aria-invalid when error={true}
 * - aria-describedby wiring via React's aria attributes
 * - Focus ring meets WCAG 2.1 AA (3:1 contrast against adjacent colors)
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, disabled, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Base styles — design token driven
          "flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm",
          "text-foreground placeholder:opacity-60",
          "transition-colors duration-150 ease-out",
          // Border & ring — error state overrides focus state
          error
            ? "border-destructive aria-invalid:ring-destructive/30 aria-invalid:border-destructive"
            : "border-input focus-visible:border-ring focus-visible:ring-ring/50",
          // States
          "focus-visible:outline-none focus-visible:ring-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          // Remove default browser styles that conflict with design tokens
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className
        )}
        disabled={disabled}
        ref={ref}
        aria-invalid={error ? true : props["aria-invalid"]}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
