"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { StagingPackage } from "@/lib/staging-packages-schema";

interface StagingPackageCardProps {
  pkg: StagingPackage;
  selected: boolean;
  onSelect: (id: string) => void;
  expanded?: boolean;
  onToggleExpand?: (id: string) => void;
  selectable?: boolean;
}

export function StagingPackageCard({
  pkg,
  selected,
  onSelect,
  expanded = false,
  onToggleExpand,
  selectable = true,
}: StagingPackageCardProps) {
  const [isExpanded, setIsExpanded] = useState(expanded);

  const handleToggleExpand = () => {
    setIsExpanded((prev) => !prev);
    onToggleExpand?.(pkg.id);
  };

  const handleSelect = () => {
    if (selectable) {
      onSelect(pkg.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelect();
    }
  };

  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-label={`${pkg.name} package: ${pkg.rooms} rooms for $${pkg.price.toLocaleString()}`}
      tabIndex={selectable ? 0 : -1}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative cursor-pointer rounded-lg border-2 p-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        selected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border bg-background hover:border-primary/50 hover:bg-secondary/30",
        !selectable && "cursor-default"
      )}
    >
      {/* Recommended badge */}
      {pkg.recommended && (
        <div className="absolute -top-3 left-4">
          <Badge
            variant="warning"
            size="sm"
            className="gap-1 shadow-sm"
            aria-label="Recommended package"
          >
            <Star className="w-3 h-3 fill-current" aria-hidden="true" />
            Recommended
          </Badge>
        </div>
      )}

      {/* Selected checkmark */}
      {selected && (
        <div className="absolute top-4 right-4">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
            <Check className="w-3 h-3 text-primary-foreground" aria-hidden="true" />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-start justify-between pr-6">
          <div>
            <h3 className="font-playfair text-lg font-semibold text-foreground">
              {pkg.name}
            </h3>
            <p className="text-sm text-muted-foreground">
              {typeof pkg.rooms === "number" ? `${pkg.rooms} rooms` : pkg.rooms}
            </p>
          </div>
          <div className="text-right">
            <p className="font-playfair text-xl font-bold text-foreground">
              ${pkg.price.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Expand/collapse inclusion list */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggleExpand();
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} inclusion list for ${pkg.name}`}
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
              Hide details
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
              Show details
            </>
          )}
        </button>

        {isExpanded && (
          <div className="mt-2 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Includes
            </p>
            <ul className="space-y-1" aria-label="Package inclusions">
              {pkg.includes.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-foreground">
                  <Check className="w-3 h-3 text-success shrink-0" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
