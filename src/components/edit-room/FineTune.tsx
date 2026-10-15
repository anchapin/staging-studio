/**
 * Issue #1341 — `<FineTune>` (advanced generation controls).
 *
 * The Magic Patterns design's `components/FineTune.tsx` is collapsed
 * by default and exposes five controls when expanded:
 *  - How much can change (0–100%, default 80)
 *  - Follow directions (0–100%, default 75)
 *  - Blend edges (0–40 px, default 12) — hidden when scope === "whole-room"
 *  - Include floor shadows (toggle, default true) — hidden when scope === "whole-room"
 *  - Seed (numeric, "Random" placeholder, non-digits stripped on change)
 *
 * The port to this repo:
 *  - The `open` state is local (mirrors the design). Tests pass an
 *    explicit `open` prop to render the inner controls in a static
 *    markup — otherwise the component starts collapsed and the inner
 *    sliders/checkbox/numeric input aren't in the DOM.
 *  - All five control values are owned by the parent (the StagePanel
 *    shell). The component never holds generation settings — it
 *    just wires them to the right callbacks.
 *  - The motion.div height transition becomes the `<Collapsible>`
 *    CSS-grid trick — same UX, zero framer-motion dependency.
 *
 * Pinned by `tests/edit-room-fine-tune.test.tsx`.
 */

"use client";

import { Collapsible } from "@/components/edit-room/collapsible";

export interface FineTuneProps {
  /** Current scope — controls whether blend-edges + shadows render. */
  scope: "whole-room" | "objects" | "paint";
  /** Open state — the panel is collapsed by default per the design. */
  open?: boolean;
  /** Controlled-mode toggle (matches the `Collapsible` API). */
  onOpenChange?: (next: boolean) => void;
  /** How-much-can-change value (0–100). */
  strength: number;
  onStrengthChange: (n: number) => void;
  /** Follow-directions value (0–100). */
  adherence: number;
  onAdherenceChange: (n: number) => void;
  /** Blend-edges value (0–40 px) — only used when scope !== "whole-room". */
  expand: number;
  onExpandChange: (n: number) => void;
  /** Include-floor-shadows toggle — only used when scope !== "whole-room". */
  shadows: boolean;
  onShadowsChange: (b: boolean) => void;
  /** Seed (digits only, stripped on change). */
  seed: string;
  onSeedChange: (s: string) => void;
}

/**
 * Renders the Fine-tune panel. The collapsed state is a single line
 * with the panel label + "Defaults" hint + the chevron. The expanded
 * state reveals three sliders (or two when scope === "whole-room") +
 * the shadows checkbox + the seed input.
 */
export function FineTune({
  scope,
  open,
  onOpenChange,
  strength,
  onStrengthChange,
  adherence,
  onAdherenceChange,
  expand,
  onExpandChange,
  shadows,
  onShadowsChange,
  seed,
  onSeedChange,
}: FineTuneProps) {
  const isWholeRoom = scope === "whole-room";

  return (
    <section className="border-t border-line-soft pt-4">
      <Collapsible
        open={open}
        onOpenChange={onOpenChange}
        trigger={({ expanded, onToggle }) => (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex w-full items-center justify-between text-sm font-semibold text-ink"
          >
            Fine-tune
            <span className="flex items-center gap-2 text-xs font-normal text-ink-subtle">
              {!expanded && "Defaults"}
              <ChevronDown
                className={
                  "h-4 w-4 transition-transform duration-150 " +
                  (expanded ? "rotate-180" : "")
                }
                aria-hidden
              />
            </span>
          </button>
        )}
      >
        <div className="flex flex-col gap-5 pt-4">
          <Slider
            label="How much can change"
            hint="Lower keeps more of the current image"
            value={strength}
            onChange={onStrengthChange}
            display={`${strength}%`}
          />
          <Slider
            label="Follow directions"
            hint="Higher sticks closer to your words"
            value={adherence}
            onChange={onAdherenceChange}
            display={`${adherence}%`}
          />
          {!isWholeRoom && (
            <>
              <Slider
                label="Blend edges"
                hint="Grows the area so frames and edges regenerate cleanly"
                value={expand}
                max={40}
                onChange={onExpandChange}
                display={`${expand}px`}
              />
              <label
                className="flex cursor-pointer items-start gap-2.5"
                aria-label="Include floor shadows"
              >
                <input
                  type="checkbox"
                  checked={shadows}
                  onChange={(e) => onShadowsChange(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  <span className="block text-[13px] font-medium text-ink">
                    Include floor shadows
                  </span>
                  <span className="block text-xs text-ink-subtle">
                    Extends the area downward to catch cast shadows
                  </span>
                </span>
              </label>
            </>
          )}
          <label className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-ink">Seed</span>
            <input
              value={seed}
              onChange={(e) => onSeedChange(e.target.value.replace(/\D/g, ""))}
              placeholder="Random"
              inputMode="numeric"
              className="h-8 w-28 rounded-md border border-line px-2 text-right font-mono text-xs text-ink placeholder:text-ink-subtle focus:border-walnut focus:outline-none"
            />
          </label>
        </div>
      </Collapsible>
    </section>
  );
}

/** Range input with label + hint + monospace tabular display. */
function Slider({
  label,
  hint,
  value,
  onChange,
  display,
  max = 100,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
  display: string;
  max?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        <span className="font-mono text-xs tabular-nums text-ink-muted">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        style={{ ["--fill" as string]: `${(value / max) * 100}%` }}
        className="atelier-slider h-1 w-full appearance-none rounded-full bg-outline/30"
      />
      <span className="text-xs text-ink-subtle">{hint}</span>
    </div>
  );
}

/** Inline chevron glyph — zero icon-library deps. */
function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}