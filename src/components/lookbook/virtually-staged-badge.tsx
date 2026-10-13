import { cn } from "@/lib/utils";
import { VIRTUALLY_STAGED_LABEL_TEXT } from "@/lib/virtually-staged-label";

/**
 * "Virtually staged" disclosure badge (issue #1186).
 *
 * Renders a small, low-opacity corner mark on AI after-images in the
 * lookbook preview so a virtually staged photo is always identifiable
 * to a viewer skimming the book. Always paired with
 * `shouldRenderVirtuallyStagedBadge` upstream — this component is a
 * pure visual, it never decides for itself whether to show.
 *
 * Styling notes: deliberately muted (bg-stone-900/70 + backdrop blur) so
 * it sits above the image without competing with the staged room for
 * attention. `font-cinzel` matches the lookbook's editorial headings
 * (see `src/app/layout.tsx`); the uppercase / tracking matches the
 * "Staging Checklist" caption in the room spread.
 *
 * The badge is a `pointer-events-none` overlay — it never blocks the
 * comparison slider's drag-to-compare handle, hover, or tooltip.
 */
export function VirtuallyStagedBadge({
  className,
  variant = "corner",
}: {
  className?: string;
  /**
   * Visual placement. `corner` (default) is the unobtrusive top-left
   * ribbon; `inline` is reserved for inline disclosure inside copy
   * blocks (not used by the lookbook preview today, kept for future
   * expansion without an API break).
   */
  variant?: "corner" | "inline";
}) {
  if (variant === "inline") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full bg-stone-900/80 px-2 py-0.5 font-cinzel text-[10px] font-semibold uppercase tracking-widest text-stone-50 backdrop-blur-sm",
          className
        )}
      >
        {VIRTUALLY_STAGED_LABEL_TEXT}
      </span>
    );
  }

  return (
    <div
      role="img"
      aria-label="Virtually staged photo disclosure"
      className={cn(
        // corner ribbon, bottom-left so it doesn't collide with the
        // existing top-left "Before" / top-right "After" pills on the
        // ComparisonSlider — see room-spread.tsx / comparison-slider.tsx.
        "pointer-events-none absolute bottom-3 left-3 z-20 inline-flex items-center gap-1.5 rounded-md bg-stone-900/70 px-2.5 py-1 font-cinzel text-[10px] font-semibold uppercase tracking-widest text-stone-50 backdrop-blur-sm",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full bg-secondary"
      />
      {VIRTUALLY_STAGED_LABEL_TEXT}
    </div>
  );
}