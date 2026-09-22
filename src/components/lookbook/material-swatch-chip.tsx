"use client";

import { useState, useRef, useEffect } from "react";
import { Copy, Check } from "lucide-react";

export interface MaterialSwatchData {
  id: string;
  name: string;
  hexCode: string;
  materialType: string;
  useCase: string;
  vendor?: string | null;
  sku?: string | null;
}

interface MaterialSwatchChipProps {
  swatch: MaterialSwatchData;
}

export function MaterialSwatchChip({ swatch }: MaterialSwatchChipProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (chipRef.current && !chipRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(swatch.hexCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback silently fail
    }
  };

  // Determine text color based on background luminance
  const hex = swatch.hexCode.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const textColor = luminance > 0.5 ? "#1a1a1a" : "#ffffff";

  return (
    <div className="relative inline-block">
      <button
        ref={chipRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${swatch.name} - ${swatch.hexCode} - click for details`}
        className="relative flex flex-col items-center rounded-lg border border-border overflow-hidden transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ width: 80, height: 80, backgroundColor: swatch.hexCode }}
      >
        <div
          className="absolute inset-0 flex flex-col items-center justify-end p-1"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 50%)",
          }}
        >
          <span
            className="font-jakarta text-[10px] font-medium leading-tight text-center line-clamp-2"
            style={{ color: textColor }}
          >
            {swatch.name}
          </span>
        </div>
      </button>

      {open && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-2 w-56 rounded-lg border border-border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {/* Color preview strip */}
          <div
            className="h-12 rounded-t-lg"
            style={{ backgroundColor: swatch.hexCode }}
          />

          <div className="p-3 space-y-3">
            {/* Header */}
            <div>
              <p className="font-playfair text-base font-semibold leading-tight">
                {swatch.name}
              </p>
              <p className="font-jakarta text-xs text-muted-foreground mt-0.5">
                {swatch.materialType} · {swatch.useCase}
              </p>
            </div>

            {/* Hex code with copy */}
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-2.5 py-1.5">
              <span className="font-mono text-sm font-medium">
                {swatch.hexCode}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="ml-2 rounded p-1 hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label="Copy hex code"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
            </div>

            {/* Vendor / SKU */}
            {(swatch.vendor || swatch.sku) && (
              <div className="space-y-1">
                {swatch.vendor && (
                  <p className="font-jakarta text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Vendor:</span>{" "}
                    {swatch.vendor}
                  </p>
                )}
                {swatch.sku && (
                  <p className="font-jakarta text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">SKU:</span>{" "}
                    {swatch.sku}
                  </p>
                )}
              </div>
            )}

            {/* Recommended use */}
            <div>
              <p className="font-jakarta text-xs text-muted-foreground">
                Recommended use
              </p>
              <p className="font-jakarta text-sm text-foreground mt-0.5">
                {swatch.useCase}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
