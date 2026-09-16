"use client";

import { cn } from "@/lib/utils";

interface VariantPickerProps {
  selectedIndex: number;
  onSelect: (index: number) => void;
  variant1Label?: string;
  variant2Label?: string;
  className?: string;
}

export function VariantPicker({
  selectedIndex,
  onSelect,
  variant1Label = "Variant A",
  variant2Label = "Variant B",
  className,
}: VariantPickerProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className={cn(
        "text-sm font-medium transition-colors",
        selectedIndex === 0 ? "text-stone-800" : "text-stone-400"
      )}>
        {variant1Label}
      </span>
      
      <button
        onClick={() => onSelect(selectedIndex === 0 ? 1 : 0)}
        className={cn(
          "relative h-6 w-12 rounded-full transition-colors duration-200",
          selectedIndex === 0 ? "bg-stone-300" : "bg-stone-800"
        )}
        aria-label="Toggle variant"
      >
        <span
          className={cn(
            "absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200",
            selectedIndex === 0 ? "left-1" : "left-7"
          )}
        />
      </button>
      
      <span className={cn(
        "text-sm font-medium transition-colors",
        selectedIndex === 1 ? "text-stone-800" : "text-stone-400"
      )}>
        {variant2Label}
      </span>
    </div>
  );
}
