import { MaterialSwatchChip, type MaterialSwatchData } from "./material-swatch-chip";
import { ProposalFooter } from "./proposal-footer";

interface MaterialSwatchPageProps {
  swatches: MaterialSwatchData[];
}

/**
 * Material Swatches page for the lookbook — displays finish and palette
 * references as a grid of clickable chips with popover detail popovers
 * (issue #553).
 *
 * Renders after the room spreads, before the closing signoff page.
 * Falls back gracefully when there are no swatches (empty state).
 */
export function MaterialSwatchPage({ swatches }: MaterialSwatchPageProps) {
  if (swatches.length === 0) {
    return null;
  }

  // Group swatches by use case for display
  const byUseCase = swatches.reduce<Record<string, MaterialSwatchData[]>>(
    (acc, swatch) => {
      const key = swatch.useCase;
      if (!acc[key]) acc[key] = [];
      acc[key].push(swatch);
      return acc;
    },
    {}
  );

  return (
    <div className="lookbook-page min-h-screen flex flex-col items-center justify-between bg-stone-50 p-12">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="max-w-4xl mx-auto w-full space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <p className="font-cinzel text-sm tracking-[0.3em] uppercase text-muted-foreground">
              Finish &amp; Palette References
            </p>
            <h2 className="font-playfair text-4xl font-bold text-foreground">
              Material Swatches
            </h2>
            <div className="w-24 h-0.5 bg-primary mx-auto" />
          </div>

          {/* Grouped swatches by use case */}
          <div className="space-y-8">
            {Object.entries(byUseCase).map(([useCase, group]) => (
              <div key={useCase} className="space-y-4">
                <h3 className="font-cinzel text-xs tracking-widest uppercase text-muted-foreground border-b border-border pb-2">
                  {useCase}
                </h3>
                <div className="flex flex-wrap gap-3">
                  {group.map((swatch) => (
                    <MaterialSwatchChip key={swatch.id} swatch={swatch} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="pt-4 border-t border-border">
            <p className="font-jakarta text-xs text-muted-foreground text-center">
              Tap a swatch to view color hex, material details, and vendor references.
            </p>
          </div>
        </div>
      </div>

      <ProposalFooter />
    </div>
  );
}
