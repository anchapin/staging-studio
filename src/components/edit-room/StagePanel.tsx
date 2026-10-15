/**
 * Issue #1341 — `<StagePanel>` (scope + scope-aware sub-panel + Directions).
 *
 * The Magic Patterns design's `components/StagePanel.tsx` is the
 * single source of staging controls for the Edit Room UX redesign
 * (collapse of the legacy three-by-three Detect / Manual / Entire tab
 * triple). The port keeps the same UX:
 *
 *  - 3-way scope segmented control (Whole room / Objects / Paint area)
 *    at the top, with the active-pill background swap behind the
 *    selected option (the framer-motion `layoutId` becomes a static
 *    colored div in this repo — see `tests/edit-room-stage-panel.test.tsx`).
 *  - Scope-aware sub-panel beneath it:
 *    - Whole room → info notice ("Furnishes the empty room…") when on
 *      the original photo, blocked-notice + "Switch to original photo"
 *      link when on a variant.
 *    - Objects → `<ConceptChips>` + "Other…" search + the
 *      `<DetectedObjectList>` of decoded instances (or a "use whole-room
 *      first" notice when the user is on the original photo).
 *    - Paint → "Brush over…" status line + "Area painted. Start over"
 *      affordance when the mask is non-empty.
 *  - Directions textarea (the single text input on the page).
 *  - "Also applied from the project: <aesthetic>" disclosure — expands
 *    to reveal the project's aesthetic + global directives + an
 *    "Edit in project settings" affordance.
 *  - `<FineTune>` (collapsed by default).
 *
 * Out-of-scope for this slice (#1342 wires it): the primary Run button
 * + the helper-text under it. The `onRun`/`running` props are NOT on
 * the StagePanel — the Inspector shell renders them.
 *
 * The StagePanel is a pure function of props. The only local state is
 * the `contextOpen` disclosure (the project-context toggle); the shell
 * owns everything else. Pinned by
 * `tests/edit-room-stage-panel.test.tsx`.
 */

"use client";

import { useState, type ReactNode } from "react";

import { Collapsible } from "@/components/edit-room/collapsible";
import { ConceptChips } from "@/components/edit-room/concept-chips";
import { DetectedObjectList } from "@/components/edit-room/detected-object-list";
import type { DetectedObject } from "@/components/edit-room/detected-object-list";
import { FineTune } from "@/components/edit-room/FineTune";
import type { EditRoomScope, SlotId } from "@/lib/edit-room-scope";

export interface StagePanelProps {
  // ─── Scope state (shell-owned) ─────────────────────────────────────
  scope: EditRoomScope;
  onScopeChange: (s: EditRoomScope) => void;

  // ─── View state (shell-owned) ──────────────────────────────────────
  viewing: SlotId;
  /** Fires when the user clicks "Switch to original photo" inside the
   *  whole-room blocked notice. */
  onViewOriginal: () => void;

  /** Where the next run will land. Required by the prop interface
   *  (forward-compat with #1342's Run button), but not rendered by
   *  this slice. */
  targetSlot: SlotId;

  // ─── Directions (shell-owned) ──────────────────────────────────────
  directions: string;
  onDirectionsChange: (v: string) => void;

  // ─── Concept / selection (shell-owned) ─────────────────────────────
  concept: string | null;
  onConceptChange: (c: string) => void;
  /** Fires when the user submits the "Other…" search form. */
  onConceptSubmit: (c: string) => void;
  selected: ReadonlyArray<string>;
  onToggleObject: (id: string) => void;
  onClearSelection: () => void;

  // ─── Detection data (shell-owned) ──────────────────────────────────
  /** The full decoded-instances array — the panel filters to the
   *  active concept locally. The shell reads from `useConceptDetection`
   *  or its eventual successor in #1344. */
  detections: ReadonlyArray<DetectedObject>;

  // ─── Paint state (shell-owned) ─────────────────────────────────────
  hasMask: boolean;
  onClearMask: () => void;

  // ─── Project context (parent route) ────────────────────────────────
  projectAesthetic: string;
  projectGlobalDirectives: string;

  // ─── #1342 — Fine-tune controls (shell-owned) ─────────────────────
  // The StagePanel renders `<FineTune>` with the shell's values. The
  // component is a pure render of these — every change handler is a
  // no-op until the shell wires them to the autosave controller
  // (#1344). Defaults match the #1341 design's literal defaults so
  // existing tests (and storybook previews without these props) keep
  // rendering the same controls.
  strength?: number;
  onStrengthChange?: (n: number) => void;
  adherence?: number;
  onAdherenceChange?: (n: number) => void;
  expand?: number;
  onExpandChange?: (n: number) => void;
  shadows?: boolean;
  onShadowsChange?: (b: boolean) => void;
  seed?: string;
  onSeedChange?: (s: string) => void;
}

/** The three scope segmented-control options. */
const SCOPES: ReadonlyArray<{ id: EditRoomScope; label: string }> = [
  { id: "whole-room", label: "Whole room" },
  { id: "objects", label: "Objects" },
  { id: "paint", label: "Paint area" },
];

export function StagePanel({
  scope,
  onScopeChange,
  viewing,
  onViewOriginal,
  targetSlot: _targetSlot,
  directions,
  onDirectionsChange,
  concept,
  onConceptChange,
  onConceptSubmit,
  selected,
  onToggleObject,
  onClearSelection,
  detections,
  hasMask,
  onClearMask,
  projectAesthetic,
  projectGlobalDirectives,
  strength = 80,
  onStrengthChange = () => {},
  adherence = 75,
  onAdherenceChange = () => {},
  expand = 12,
  onExpandChange = () => {},
  shadows = true,
  onShadowsChange = () => {},
  seed = "",
  onSeedChange = () => {},
}: StagePanelProps): ReactNode {
  const [contextOpen, setContextOpen] = useState(false);
  const onOriginal = viewing === "original";
  const found = detections.filter((d) => d.concept === concept);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-5 py-5">
      {/* ─── 1. Scope segmented control + scope-aware sub-panel ─────── */}
      <section
        aria-labelledby="scope-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="scope-heading"
          className="text-sm font-semibold text-ink"
        >
          What should change?
        </h2>
        <div
          role="radiogroup"
          aria-labelledby="scope-heading"
          className="grid grid-cols-3 rounded-lg bg-surface-mid p-1"
        >
          {SCOPES.map((s) => {
            const active = scope === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onScopeChange(s.id)}
                className={
                  "relative h-8 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors duration-150 " +
                  (active ? "text-ink" : "text-ink-subtle hover:text-ink")
                }
              >
                {active && (
                  <span
                    data-testid="scope-pill"
                    className="absolute inset-0 rounded-md bg-surface-lowest shadow-[0_1px_2px_rgba(32,26,21,0.12)]"
                  />
                )}
                <span className="relative">{s.label}</span>
              </button>
            );
          })}
        </div>

        {scope === "whole-room" &&
          (onOriginal ? (
            <p className="text-[13px] leading-relaxed text-ink-muted">
              Furnishes the empty room from scratch in the project style.
            </p>
          ) : (
            <Notice>
              Whole-room staging works on the empty original, so it can&apos;t
              stack on Variant {viewing}.
              <button
                type="button"
                onClick={onViewOriginal}
                className="mt-1.5 block font-semibold text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
              >
                Switch to original photo
              </button>
            </Notice>
          ))}

        {scope === "objects" &&
          (onOriginal ? (
            <Notice>
              The original photo is empty. Use{" "}
              <span className="font-semibold">Whole room</span> to stage it,
              then pick objects on a variant to swap them.
            </Notice>
          ) : (
            <div className="flex flex-col gap-3">
              <ConceptChips
                concept={concept}
                onConceptChange={onConceptChange}
                onConceptSubmit={onConceptSubmit}
              />
              <DetectedObjectList
                found={found}
                selected={selected}
                onToggleObject={onToggleObject}
                onClearSelection={onClearSelection}
              />
            </div>
          ))}

        {scope === "paint" && (
          <p className="text-[13px] leading-relaxed text-ink-muted">
            {hasMask ? (
              <>
                Area painted.{" "}
                <button
                  type="button"
                  onClick={onClearMask}
                  className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
                >
                  Start over
                </button>
              </>
            ) : (
              "Brush over the part of the photo you want to restage — a wall, a corner, a single piece."
            )}
          </p>
        )}
      </section>

      {/* ─── 2. Directions — the only text input on the page ─────────── */}
      <section
        aria-labelledby="dir-heading"
        className="flex flex-col gap-2"
      >
        <label
          id="dir-heading"
          htmlFor="directions"
          className="text-sm font-semibold text-ink"
        >
          Directions
        </label>
        <textarea
          id="directions"
          rows={5}
          value={directions}
          onChange={(e) => onDirectionsChange(e.target.value)}
          maxLength={2000}
          placeholder="e.g. Modern coastal furniture, light neutrals, natural textures…"
          className="w-full resize-none rounded-lg border border-line bg-surface-lowest px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus:border-walnut focus:outline-none focus:ring-2 focus:ring-walnut/10"
        />
        <Collapsible
          open={contextOpen}
          onOpenChange={setContextOpen}
          trigger={({ expanded, onToggle }) => (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="flex items-center gap-1.5 self-start text-xs text-ink-subtle hover:text-ink-muted"
            >
              <ChevronDown
                className={
                  "h-3.5 w-3.5 transition-transform duration-150 " +
                  (expanded ? "rotate-180" : "")
                }
                aria-hidden
              />
              Also applied from the project:{" "}
              <span className="font-medium text-ink-muted">{projectAesthetic}</span>
            </button>
          )}
        >
          <div className="mt-1 flex flex-col gap-2 rounded-lg bg-surface-low px-3 py-2.5 text-xs">
            <div>
              <dt className="text-ink-subtle">Style</dt>
              <dd className="text-ink">{projectAesthetic}</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Rules for every room</dt>
              <dd className="text-ink">{projectGlobalDirectives}</dd>
            </div>
            <button
              type="button"
              className="self-start font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
            >
              Edit in project settings
            </button>
          </div>
        </Collapsible>
      </section>

      {/* ─── 3. Fine-tune, out of the way until wanted ──────────────── */}
      <FineTune
        scope={scope}
        strength={strength}
        onStrengthChange={onStrengthChange}
        adherence={adherence}
        onAdherenceChange={onAdherenceChange}
        expand={expand}
        onExpandChange={onExpandChange}
        shadows={shadows}
        onShadowsChange={onShadowsChange}
        seed={seed}
        onSeedChange={onSeedChange}
      />
    </div>
  );
}

/** Compact info notice — bg-surface-low + Info icon + body content. */
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg bg-surface-low px-3 py-2.5 text-[13px] leading-relaxed text-ink-muted">
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Inline `Info` glyph — keeps the panel zero icon-library deps. */
function InfoIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

/** Inline `ChevronDown` glyph — zero icon-library deps. */
function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={14}
      height={14}
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