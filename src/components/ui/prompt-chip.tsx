"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

export type PromptChipVariant = "suggestion" | "directive" | "injection" | "filter";

export interface PromptChipProps {
  variant?: PromptChipVariant;
  icon?: string;
  label: string;
  onClick?: (label: string) => void;
  onDismiss?: (label: string) => void;
  active?: boolean;
  className?: string;
}

const variantStyles: Record<PromptChipVariant, { base: string; hover: string; active?: string }> = {
  suggestion: {
    base: "bg-secondary/10 text-secondary border border-secondary/20 rounded-full",
    hover: "hover:bg-secondary/20",
    active: "bg-secondary/20",
  },
  directive: {
    base: "bg-surface text-on-surface border border-outline-variant/30 rounded-full",
    hover: "hover:border-outline-variant/60",
    active: "bg-primary text-primary-foreground",
  },
  injection: {
    base: "bg-background border border-input rounded-full",
    hover: "hover:border-stone-400 hover:bg-secondary",
    active: "bg-secondary text-secondary-foreground border-secondary",
  },
  filter: {
    base: "bg-secondary/10 text-secondary border border-secondary/20 rounded-full",
    hover: "hover:bg-secondary/20",
    active: "bg-secondary text-secondary-foreground",
  },
};

export function PromptChip({
  variant = "suggestion",
  icon,
  label,
  onClick,
  onDismiss,
  active = false,
  className,
}: PromptChipProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [showFlash, setShowFlash] = useState(false);

  const handleClick = useCallback(() => {
    if (onClick) {
      onClick(label);
      setShowFlash(true);
      setIsAnimating(true);
      setTimeout(() => {
        setShowFlash(false);
        setIsAnimating(false);
      }, 80);
    }
  }, [onClick, label]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsRemoving(true);
      setTimeout(() => {
        onDismiss?.(label);
      }, 100);
    },
    [onDismiss, label]
  );

  const styles = variantStyles[variant];
  const isActive = active || isAnimating;

  return (
    <span className="group/chip relative inline-flex items-center">
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "animate-chip-appear inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          styles.base,
          styles.hover,
          isActive && styles.active,
          isRemoving && "animate-chip-remove opacity-0 -translate-y-0.5",
          showFlash && "animate-chip-flash",
          className
        )}
        aria-pressed={variant === "filter" || variant === "directive" ? isActive : undefined}
      >
        {icon && (
          <span
            className="material-symbols-outlined icon-xs"
            style={
              icon === "auto_awesome"
                ? { fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 16" }
                : undefined
            }
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <span>{label}</span>
      </button>
      {onDismiss && (
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute -right-1 -top-1 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-muted text-muted-foreground opacity-0 transition-opacity hover:bg-secondary/40 hover:text-foreground focus:opacity-100 focus:outline-none group-hover/chip:opacity-100"
          aria-label={`Remove ${label}`}
          tabIndex={-1}
        >
          ×
        </button>
      )}
    </span>
  );
}

interface PromptChipGroupProps {
  children: React.ReactNode;
  className?: string;
  overflow?: boolean;
}

export function PromptChipGroup({ children, className, overflow = false }: PromptChipGroupProps) {
  if (overflow) {
    return (
      <div
        className={cn(
          "relative flex items-center gap-1.5 overflow-x-auto px-4 py-1",
          className
        )}
        style={{
          maskImage:
            "linear-gradient(to right, transparent 0%, black 1rem, black calc(100% - 1rem), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0%, black 1rem, black calc(100% - 1rem), transparent 100%)",
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {children}
    </div>
  );
}
