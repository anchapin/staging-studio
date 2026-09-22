"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Moon, Sun } from "lucide-react";

interface ZenModeToolbarProps {
  className?: string;
  children: ReactNode;
  /** Issue #560: whether dark background is active. */
  darkBackground?: boolean;
  /** Issue #560: callback when dark/light background toggle is clicked. */
  onDarkBackgroundChange?: (dark: boolean) => void;
}

/**
 * Issue #560: Zen Mode floating pill-shaped toolbar.
 * A minimal, always-visible toolbar that floats at the bottom-center of the viewport
 * during Zen Mode. Contains the essential brush controls.
 */
export default function ZenModeToolbar({
  className,
  children,
  darkBackground = false,
  onDarkBackgroundChange,
}: ZenModeToolbarProps) {
  return (
    <div
      className={cn(
        "fixed bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-stone-200 bg-white/95 backdrop-blur-sm px-4 py-2 shadow-xl shadow-black/10",
        className
      )}
      style={{ minWidth: "max-content" }}
    >
      {children}

      {/* Divider */}
      <div className="h-6 w-px bg-stone-200" aria-hidden="true" />

      {/* Dark/light background toggle */}
      <button
        type="button"
        onClick={() => onDarkBackgroundChange?.(!darkBackground)}
        title={darkBackground ? "Switch to light background" : "Switch to dark background"}
        aria-label={darkBackground ? "Switch to light background" : "Switch to dark background"}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100 text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900"
      >
        {darkBackground ? (
          <Sun className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Moon className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
